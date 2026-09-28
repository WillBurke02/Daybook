"""One runnable check for Money:  python3 tests/test_money.py

Covers everything that would silently produce a wrong number: migrations, shift
arithmetic, overtime, PAYE, statement anchoring and reconciliation, category
kinds, payee normalisation and matching, the import sign convention, undo,
payslips, holidays, reminders, safe to spend, receipts, the calendar feed's
events, and Admin's tools against a Money database. The server's doors and
sign-in are in test_suite.py.
"""
import os
import sqlite3
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from core import db as _db, api                     # noqa: E402
from apps.money import app as money, importer, matching, tax, timesheet, reminders  # noqa: E402

close = lambda a, b, eps=0.01: abs((a or 0) - (b or 0)) < eps
tmp = tempfile.TemporaryDirectory()
DB = os.path.join(tmp.name, "t.db")
db = _db.open_db(DB, money, quiet=True)
one = lambda sql, *a: db.execute(sql, a).fetchone()


def expect(code, fn, what=""):
    try:
        fn()
    except api.Err as e:
        assert e.code == code, (what, e.code, e.msg)
        return
    raise SystemExit(f"FAIL: expected {code} — {what}")


# === migrations ==============================================================
assert one("SELECT COUNT(*) n FROM schema_version")["n"] == len(os.listdir(money.MIGRATIONS))
assert _db.pending(db, money) == []
_db.rebuild_views(db, money)                # idempotent: views rebuild every boot
assert one("SELECT COUNT(*) n FROM sqlite_master WHERE type='view'")["n"] > 25
# journal mode must stay out of WAL: the sidecar file and a yanked stick don't mix
assert one("PRAGMA journal_mode")[0].lower() in ("delete", "truncate")

# === normalisation: the Trading 212 problem ==================================
# Normalisation removes what VARIES between two visits to the same payee — card
# suffixes, dates, references, terminal prefixes. It does not try to guess town
# names, so it is not expected to collapse every spelling to one string; that is
# what a rule does, and the real requirement is tested straight after.
N = matching.normalise
assert N("POS TRADING 212 UK LTD *8842  LONDON GB") == "TRADING 212 UK LONDON", \
    N("POS TRADING 212 UK LTD *8842  LONDON GB")
assert N("TRADING212*8842") == "TRADING212"
assert N("CRD TESCO STORES 3411 ON 03 JUL") == "TESCO STORES", N("CRD TESCO STORES 3411 ON 03 JUL")
assert N("SQ *THE BEAN STOKE") == "THE BEAN STOKE"
assert N("DIRECT DEBIT OCTOPUS ENERGY LTD REF: 88213344") == "OCTOPUS ENERGY"
assert N("CONTACTLESS SHELL TRENTHAM GB") == "SHELL TRENTHAM"
assert N("") == ""                          # never raises on junk
# the same visit twice, spelled differently by the bank, must normalise the same
assert N("POS TESCO STORES 3411 ON 03 JUL") == N("CRD TESCO STORES 3411 *8842 12/06")


# === categories behave by kind, not by name ==================================
db.executescript("""
INSERT INTO account (name,kind,last4,opening) VALUES
 ('Barclays Current','current','4417',0),
 ('Santander Joint','current','9982',0),
 ('Santander Saver ISA','savings','1123',0),
 ('Trading 212 ISA','investment','7740',0);
INSERT INTO category (id,parent_id,name,kind) VALUES
 (1,NULL,'Salary','income'),          -- named Salary, behaves as income
 (2,NULL,'Moving money','transfer'),
 (3,NULL,'Groceries','spend'),
 (4,3,   'Tesco','spend'),
 (5,3,   'Aldi','spend'),
 (6,NULL,'Vehicle','spend'),
 (7,6,   'Finance','spend'),
 (8,6,   'Fuel','spend');
INSERT INTO tag (name,kind) VALUES ('Octavia','vehicle');
""")
mid_sal = matching.ensure_merchant(db, "TS247", 1)
mid_mov = matching.ensure_merchant(db, "Internal", 2, is_internal=1)
mid_tes = matching.ensure_merchant(db, "Tesco", 4)
mid_fin = matching.ensure_merchant(db, "Black Horse", 7)
mid_shl = matching.ensure_merchant(db, "Shell", 8)
for mid, pat in ((mid_sal, "TS247"), (mid_mov, "TO SAVER"), (mid_mov, "TO T212"),
                 (mid_mov, "FROM BARCLAYS"), (mid_tes, "TESCO"),
                 (mid_fin, "BLACK HORSE"), (mid_shl, "SHELL")):
    db.execute("INSERT INTO match_rule (merchant_id,kind,pattern) VALUES (?,'contains',?)",
               (mid, pat))
OCTAVIA = db.execute("SELECT id FROM tag WHERE name='Octavia'").fetchone()["id"]
db.execute("UPDATE merchant SET default_tag=? WHERE id IN (?,?)", (OCTAVIA, mid_fin, mid_shl))
db.commit()

db.executescript("""
INSERT INTO txn (account_id,date,description,amount) VALUES
 (1,'2026-07-25','TS247 SALARY',2000),
 (1,'2026-07-25','TO SAVER',-600),(3,'2026-07-25','FROM BARCLAYS',600),
 (1,'2026-07-25','TO T212',-150),(4,'2026-07-25','FROM BARCLAYS',150),
 (1,'2026-07-10','CRD TESCO STORES 3411 ON 03 JUL',-120),
 (1,'2026-07-15','BLACK HORSE FINANCE',-218),
 (1,'2026-07-18','POS SHELL TRENTHAM *8842',-62),
 (1,'2026-07-20','SOMETHING NEW LTD',-40);
""")
db.commit()
assert matching.rescan(db) >= 8

# This is the bug that started it: wages called "Salary" must not read as
# negative spending, and moving money must not read as spending at all.
m = one("SELECT * FROM v_month WHERE month='2026-07'")
assert close(m["income"], 2000), dict(m)
assert close(m["spend"], 440), dict(m)      # 120 + 218 + 62 + 40 unmatched
assert close(m["saved"], 750)               # 600 ISA + 150 T212, counted where they land
assert close(m["left_over"], 1560)
assert m["unsorted"] == 1                   # SOMETHING NEW LTD, and it still counts as spend
assert one("SELECT category_kind FROM v_txn WHERE description LIKE 'TS247%'")["category_kind"] == "income"
assert not [r for r in db.execute("SELECT * FROM v_cat_actual WHERE actual < 0")], \
    "no spending category may be negative once kinds are right"

# the child rolls up into its group
tesco = one("SELECT * FROM v_cat_actual WHERE month='2026-07' AND category_path='Groceries · Tesco'")
assert tesco["group_name"] == "Groceries" and close(tesco["actual"], 120)

# === merchant matching, priority and locking =================================
# THE requirement: however the bank spells Trading 212, one rule resolves it to
# one payee with one category. This is the thing the old LIKE matching could not do.
t212 = matching.ensure_merchant(db, "Trading 212", 2)
db.execute("INSERT INTO match_rule (merchant_id,kind,pattern) VALUES (?,'contains','TRADING 212')",
           (t212,))
db.execute("INSERT INTO match_rule (merchant_id,kind,pattern) VALUES (?,'contains','TRADING212')",
           (t212,))
db.execute("INSERT INTO match_rule (merchant_id,kind,pattern,priority) "
           "VALUES (?,'prefix','T212',50)", (t212,))
db.commit()
rules = [dict(r) for r in db.execute("SELECT merchant_id,kind,pattern,priority FROM match_rule")]
for spelling in ("POS TRADING 212 UK LTD *8842  LONDON GB", "TRADING212*8842",
                 "T212 DEP 12JUN", "TRADING 212 UK"):
    assert matching.match_one(rules, N(spelling)) == t212, spelling

assert one("SELECT merchant FROM v_txn WHERE description LIKE 'CRD TESCO%'")["merchant"] == "Tesco"
db.execute("INSERT INTO match_rule (merchant_id,kind,pattern,priority) "
           "VALUES (?,'exact','TESCO STORES',10)", (mid_sal,))
matching.rescan(db)
assert one("SELECT merchant FROM v_txn WHERE description LIKE 'CRD TESCO%'")["merchant"] == "TS247", \
    "an exact rule at priority 10 must beat a contains rule at 100"
db.execute("DELETE FROM match_rule WHERE kind='exact'")
matching.rescan(db)

# a payee assigned by hand is never overwritten by a rescan
tid = one("SELECT id FROM txn WHERE description='SOMETHING NEW LTD'")["id"]
db.execute("UPDATE txn SET merchant_id=?, merchant_locked=1 WHERE id=?", (mid_tes, tid))
db.commit()
matching.rescan(db)
assert one("SELECT merchant_id FROM txn WHERE id=?", tid)["merchant_id"] == mid_tes
db.execute("UPDATE txn SET merchant_id=NULL, merchant_locked=0 WHERE id=?", (tid,))
db.commit()
matching.rescan(db)

# === sorting a payee ==========================================================
q = [dict(r) for r in db.execute("SELECT * FROM v_unmatched")]
assert q and q[0]["description_norm"] == "SOMETHING NEW", q[0]["description_norm"]
# typing "Group · Child" creates the child; the rule written sorts it next time
res = money.accept(db, {"description_norm": "SOMETHING NEW", "payee": "Something New",
                      "category": "Groceries · Market stall"})
assert res["changed"] >= 1
assert not db.execute("SELECT 1 FROM v_unmatched").fetchone(), "sorting must clear the queue"
assert one("SELECT category_path FROM v_txn WHERE description='SOMETHING NEW LTD'")["category_path"] \
       == "Groceries · Market stall"
assert matching.explain(db, "POS SOMETHING NEW LTD *1234")["rule"]["payee"] == "Something New"
assert matching.preview(db, "contains", "tesco")["count"] == 1
assert one("SELECT COUNT(*) n FROM v_txn WHERE category_kind='unmatched'")["n"] == 0

# === statements: anchoring, reconciliation, coverage =========================
db.executescript("""
INSERT INTO statement (id,account_id,filename,period_start,period_end,
                       opening_balance,closing_balance,row_count,role,content_hash)
VALUES (1,1,'jul.csv','2026-07-01','2026-07-31',5000,5810,7,'current','h1');
UPDATE txn SET statement_id=1 WHERE account_id=1;
""")
db.commit()
chk = one("SELECT * FROM v_statement_check WHERE id=1")
assert close(chk["movement"], 810) and chk["status"] == "balanced", dict(chk)

# the balance is what the statement says, never a sum the app worked out
st = one("SELECT * FROM v_account_status WHERE id=1")
assert close(st["balance"], 5810) and st["as_of"] == "2026-07-31", dict(st)
db.execute("INSERT INTO txn (account_id,date,description,amount) VALUES (1,'2026-08-02','LATER',-10)")
db.commit()
assert close(one("SELECT balance FROM v_account_status WHERE id=1")["balance"], 5810), \
    "a later transaction must not move the printed balance"
db.execute("UPDATE statement SET closing_balance=NULL WHERE id=1")
assert one("SELECT balance FROM v_account_status WHERE id=1")["balance"] is None, \
    "no closing balance typed means no balance shown, not a guess"
db.execute("UPDATE statement SET closing_balance=5810 WHERE id=1")
db.commit()

# a statement that does not balance is caught
db.execute("UPDATE statement SET closing_balance=9999 WHERE id=1")
db.commit()
assert one("SELECT status FROM v_statement_check WHERE id=1")["status"] == "off"
assert close(one("SELECT discrepancy FROM v_statement_check WHERE id=1")["discrepancy"], 4189)
db.execute("UPDATE statement SET closing_balance=5810 WHERE id=1")

# only one statement per account can be current — the database enforces it
db.execute("INSERT INTO statement (id,account_id,filename,period_start,period_end,role,"
           "content_hash) VALUES (2,1,'jun.csv','2026-06-01','2026-06-30','history','h2')")
db.commit()
try:
    db.execute("UPDATE statement SET role='current' WHERE id=2")
    db.commit()
    raise SystemExit("FAIL: two current statements were allowed")
except sqlite3.IntegrityError:
    db.rollback()

# gaps and overlaps
db.execute("INSERT INTO statement (id,account_id,filename,period_start,period_end,role,"
           "content_hash) VALUES (3,1,'apr.csv','2026-04-01','2026-04-30','history','h3')")
db.commit()
gaps = [dict(r) for r in db.execute("SELECT * FROM v_coverage_gap WHERE account_id=1")]
assert any(g["days"] == 31 and g["gap_from"] == "2026-05-01" for g in gaps), gaps

# === import: the sign convention =============================================
CSV_SIGNED = ("Date,Description,Amount\n"
              "10/07/2026,TESCO STORES,-120.00\n"
              "25/07/2026,TS247 SALARY,2000.00\n")
plan = importer.plan_one(db, CSV_SIGNED, "barclays-jul.csv", account_id=1)
assert plan["count"] == 2 and plan["money_out"] == 1 and plan["money_in"] == 1
assert close(plan["out_total"], 120) and close(plan["in_total"], 2000)
assert plan["period_start"] == "2026-07-10" and plan["period_end"] == "2026-07-25"

# a file where outgoings are written positive: you tick flip, it flips
CSV_POS = ("Date,Description,Amount\n" +
           "".join(f"0{i}/07/2026,SHOP {i},{i*10}.00\n" for i in range(1, 7)))
assert importer.plan_one(db, CSV_POS, "pos.csv", account_id=1)["money_in"] == 6
assert importer.plan_one(db, CSV_POS, "pos.csv", account_id=1, flip=True)["money_out"] == 6
# and a column you choose beats the guess
alt = importer.plan_one(db, "Date,Payee,Out\n01/07/2026,X,5.00\n", "m.csv", account_id=1,
                        mapping={"date": 0, "description": 1, "amount": 2, "style": "signed"}, flip=True)
assert alt["rows"][0]["amount"] == -5.0

# paid in / paid out layout
CSV_INOUT = ("Date,Description,Paid out,Paid in,Balance\n"
             "01/08/2026,TESCO,45.20,,900.00\n"
             "02/08/2026,SALARY,,2500.00,3400.00\n")
p4 = importer.plan_one(db, CSV_INOUT, "santander.csv", account_id=2)
assert p4["mapping"]["style"] == "inout"
assert [r["amount"] for r in p4["rows"]] == [-45.2, 2500.0], p4["rows"]

# money the way banks write it
assert close(importer.num("£1,234.56"), 1234.56)
assert close(importer.num("(45.20)"), -45.20)
assert close(importer.num("45.20 DR"), -45.20)
assert close(importer.num("45.20-"), -45.20)
assert importer.num("") == 0
assert importer.norm_date("05/01/2026") == "2026-01-05"      # UK day-first
assert importer.norm_date("05 Jan 2026") == "2026-01-05"
assert importer.norm_date("2026-01-05") == "2026-01-05"
assert importer.norm_date("nonsense") is None

# the account is always chosen, never guessed from the file
CSV_ACC = ("Account 1123 statement\nDate,Description,Amount\n01/08/2026,X,-5.00\n")
guess = importer.plan_one(db, CSV_ACC, "saver-1123.csv")
assert guess["account_id"] is None and guess["count"] == 1
try:
    importer.commit(db, guess)
    raise SystemExit("FAIL: a statement went in with no account")
except ValueError as e:
    assert "account" in str(e)

# committing: reconciles, becomes current, demotes the old one, no duplicates
p5 = importer.plan_one(db, CSV_SIGNED, "barclays-jul2.csv", account_id=2,
                       opening=100, closing=1980)
assert p5["reconciles"], p5["discrepancy"]
sid = importer.commit(db, p5, make_current=True)
assert one("SELECT role FROM statement WHERE id=?", sid)["role"] == "current"
assert one("SELECT COUNT(*) n FROM statement WHERE account_id=2 AND role='current'")["n"] == 1
try:
    importer.commit(db, importer.plan_one(db, CSV_SIGNED, "again.csv", account_id=2))
    raise SystemExit("FAIL: the same file was imported twice")
except ValueError as e:
    assert "already imported" in str(e)

# import resolves payees on the way in
assert one("SELECT merchant FROM v_txn WHERE statement_id=? AND amount>0", sid)["merchant"] == "TS247"

# bulk: grouped by account, gaps found, duplicates skipped
files = [("bulk-a.csv", "Date,Description,Amount\n01/03/2026,TESCO,-10.00\n"
                        "28/03/2026,TESCO,-12.00\n"),
         ("bulk-b.csv", "Date,Description,Amount\n01/06/2026,TESCO,-10.00\n"
                        "28/06/2026,TESCO,-12.00\n"),
         ("dupe.csv", CSV_SIGNED)]
bulk = importer.plan_bulk(db, [(n, t, 1) for n, t in files])
assert len(bulk["duplicates"]) == 1, bulk["duplicates"]
grp = bulk["groups"][0]
assert grp["files"] == 2 and grp["rows"] == 4
assert any(g["days"] > 0 for g in grp["gaps"]), "the April–May gap must be reported"

# === tags: one car, every category ===========================================
for r in db.execute("SELECT id FROM txn WHERE description LIKE '%SHELL%' "
                    "OR description LIKE '%BLACK HORSE%'"):
    db.execute("INSERT OR IGNORE INTO txn_tag (txn_id,tag_id) VALUES (?,?)", (r["id"], OCTAVIA))
db.commit()
tt = one("SELECT * FROM v_tag_total WHERE tag='Octavia'")
assert tt["n"] == 2 and close(tt["total"], 280)
cats = {r[0] for r in db.execute("SELECT DISTINCT category FROM v_tag_spend WHERE tag='Octavia'")}
assert cats == {"Vehicle · Finance", "Vehicle · Fuel"}, cats

# === joint account share =====================================================
db.execute("UPDATE account SET share_pct=50 WHERE name='Santander Joint'")
db.execute("INSERT INTO txn (account_id,date,description,amount,category_id) "
           "VALUES (2,'2026-09-05','JOINT SHOP',-100,3)")
db.commit()
sep = one("SELECT spend FROM v_month WHERE month='2026-09'")
assert close(sep["spend"], 50), f"a 50% joint account should contribute half: {dict(sep)}"
db.execute("UPDATE account SET share_pct=100 WHERE name='Santander Joint'")
db.commit()

# === hours and overtime (carried over, still correct) ========================
db.executescript("""
INSERT INTO shift (date,start,end) VALUES
 ('2026-09-21','08:00','16:30'),     -- Mon 8.5h
 ('2026-09-21','18:00','21:00'),     -- + a split shift
 ('2026-09-22','22:00','06:00'),     -- crosses midnight -> 8h
 ('2026-09-25','08:00','16:30'),     -- Fri 8.5h, threshold 7.5
 ('2026-09-26','09:00','13:00');     -- Sat, all overtime
INSERT INTO pay_rate (from_date,annual) VALUES ('2026-01-01',45000);
""")
db.commit()
mon = one("SELECT * FROM v_day WHERE date='2026-09-21'")
assert close(mon["hours"], 11.5) and mon["shifts"] == 2
assert close(mon["ot_hours"], 3.0) and close(mon["paid_hours"], 13.0)
assert close(one("SELECT hours FROM v_day WHERE date='2026-09-22'")["hours"], 8.0)
assert close(one("SELECT ot_hours FROM v_day WHERE date='2026-09-25'")["ot_hours"], 1.0)
sat = one("SELECT * FROM v_day WHERE date='2026-09-26'")
assert close(sat["ot_hours"], 4.0) and close(sat["paid_hours"], 8.0)
hourly = 45000 / (52 * 39)   # contract hours default to 39: £26k is £12.82/h
assert close(one("SELECT ot_pay FROM v_day_paid WHERE date='2026-09-21'")["ot_pay"],
             round(3 * 1.5 * hourly, 2))

# === PAYE, hand-checked against published 2026/27 figures ====================
b = tax.breakdown(db, 60000, 2026)
assert close(b["taxable"], 44430) and close(b["tax"], 10232)
assert close(b["ni"], 3210.60) and close(b["er_ni"], 8250)
assert close(b["student_loan"], 2837) and close(b["net"], 40720.40)
sac = tax.breakdown(db, 60000, 2026, pension_relief="sacrifice")
assert close(sac["net"] - b["net"], 330.00)          # sacrifice dodges NI too
hi = tax.breakdown(db, 120000, 2026, pension_pct="0", student_loan_plan="none")
assert close(hi["allowance"], 2570) and close(hi["tax"], 39432)   # the 60% trap
assert close(tax.breakdown(db, 5000, 2026, periods=12)["ni"] * 12, b["ni"])
assert tax.tax_year_of("2026-04-05") == 2025 and tax.tax_year_of("2026-04-06") == 2026


# === hours in: Clockify and spreadsheets =====================================
CLOCKIFY = ("Project,Client,Description,Task,User,Email,Tags,Billable,Start Date,Start Time,"
            "End Date,End Time,Duration (h),Duration (decimal),Billable Rate,Amount,Id\n"
            "Ultrasonic rig,TS247,Panel wiring,,Will,w@x,,Yes,05/10/2026,08:00,05/10/2026,17:00,9:00,9.00,0,0,ck1\n"
            "Ultrasonic rig,TS247,Site callout,,Will,w@x,,Yes,05/10/2026,19:00,05/10/2026,21:30,2:30,2.50,0,0,ck2\n"
            "Motor test,TS247,Commissioning,,Will,w@x,,Yes,10/10/2026,09:00,10/10/2026,14:00,5:00,5.00,0,0,ck3\n")
p1 = timesheet.plan_hours(CLOCKIFY, "clockify.csv")
assert p1["source"] == "clockify" and p1["count"] == 3
assert close(p1["total_hours"], 16.5), p1["total_hours"]
r = timesheet.commit_hours(db, p1)
assert r == {"added": 3, "updated": 0}
# re-exporting the same week must update, not double: the Clockify id comes with it
assert timesheet.commit_hours(db, timesheet.plan_hours(CLOCKIFY, "clockify.csv")) \
       == {"added": 0, "updated": 3}
assert one("SELECT COUNT(*) n FROM shift WHERE source='clockify'")["n"] == 3

# the old Overtime and Pay sheet: Date, Started, Finished, Hours (hh:mm), Miles, Notes
SHEET = ("Date,Started,Finished,Hours,Miles,Expenses/Notes\n"
         "06/10/2026,08:00,17:30,09:30,,NDT\n07/10/2026,9:00 AM,5:00 PM,08:00,,\n")
p2 = timesheet.plan_hours(SHEET, "sheet.csv")
assert p2["source"] == "spreadsheet" and p2["count"] == 2
assert close(p2["total_hours"], 17.5), p2["total_hours"]
assert timesheet.to_hhmm("9:00 AM") == "09:00" and timesheet.to_hhmm("5:00 PM") == "17:00"
assert timesheet.to_hhmm("0900") == "09:00" and timesheet.to_hhmm("rubbish") is None
timesheet.commit_hours(db, p2)

# the split day still totals as one day, with overtime on the whole
oct5 = one("SELECT * FROM v_day WHERE date='2026-10-05'")
assert oct5["shifts"] == 2 and close(oct5["hours"], 11.5) and close(oct5["ot_hours"], 3.0)

# === hours out: the sheet HR gets ============================================
# the same columns as the spreadsheet HR already receives; a split day is two rows
tbl = timesheet.hr_table(db, "2026-10")
assert tbl[0] == ["Date", "Started", "Finished", "Hours", "Notes"], tbl[0]
day5 = [r for r in tbl if r and r[0] == "05/10/2026"]
assert [(r[1], r[2], r[3]) for r in day5] == [("08:00", "17:00", "09:00"), ("19:00", "21:30", "02:30")], day5
totals = {r[0]: r[3] for r in tbl if r and r[0].startswith(("Total", "Overtime"))}
assert totals == {"Total hours": "34:00", "Overtime x1.5": "04:00", "Overtime x2": "05:00"}, totals
tsv = timesheet.hr_tsv(db, "2026-10")
assert tsv.splitlines()[0] == "Date\tStarted\tFinished\tHours\tNotes"
assert timesheet.hr_csv(db, "2026-10").startswith("Date,Started,")

# === hours at any granularity ================================================
grains = {r["grain"] for r in db.execute("SELECT DISTINCT grain FROM v_hours_period")}
assert grains == {"week", "month", "bimonth", "quarter", "year", "taxyear"}, grains
oct_ = one("SELECT * FROM v_hours_period WHERE grain='month' AND period='2026-10'")
assert close(oct_["hours"], 11.5 + 5 + 9.5 + 8), dict(oct_)
# bimonth 5 is September AND October together, which is the point of it
sep = one("SELECT * FROM v_hours_period WHERE grain='month' AND period='2026-09'")
bi = one("SELECT * FROM v_hours_period WHERE grain='bimonth' AND period='2026-B5'")
assert bi and close(bi["hours"], oct_["hours"] + (sep["hours"] if sep else 0)), dict(bi)
assert one("SELECT * FROM v_hours_period WHERE grain='quarter' AND period='2026-Q4'")

# === the decisions: joint share, valuations, lending =========================
# 3. an investment is worth its valuation, not the sum of what went in
db.execute("INSERT INTO txn (account_id,date,description,amount) VALUES (4,'2026-11-01','FROM BARCLAYS',1000)")
db.execute("INSERT INTO valuation (account_id,date,value) VALUES (4,'2026-11-30',1250)")
db.commit()
inv = one("SELECT * FROM v_invest WHERE id=4")
assert close(inv["value"], 1250), dict(inv)
# deposited counts everything ever paid in, including the earlier test rows
assert close(inv["gain"], inv["value"] - inv["deposited"]), dict(inv)
assert close(one("SELECT valuation FROM v_account_status WHERE id=4")["valuation"], 1250)

# 6. money lent to a friend is not spending
dave = db.execute("INSERT INTO tag (name,kind) VALUES ('Dave','person')").lastrowid
lend = db.execute("INSERT INTO category (name,kind) VALUES ('Lent out','lending')").lastrowid
lid = db.execute("INSERT INTO txn (account_id,date,description,amount,category_id,merchant_locked) "
                 "VALUES (1,'2026-12-02','FASTER PAYMENT D SMITH',-200,?,1)", (lend,)).lastrowid
db.execute("INSERT INTO txn_tag (txn_id,tag_id) VALUES (?,?)", (lid, dave))
db.commit()
assert close(one("SELECT spend FROM v_month WHERE month='2026-12'")["spend"], 0), \
    "lending must not count as spending"
owed = one("SELECT * FROM v_owed WHERE person='Dave'")
assert close(owed["lent"], 200) and close(owed["net"], 200)
# he pays half back
rid = db.execute("INSERT INTO txn (account_id,date,description,amount,category_id,merchant_locked) "
                 "VALUES (1,'2026-12-20','FASTER PAYMENT D SMITH',100,?,1)", (lend,)).lastrowid
db.execute("INSERT INTO txn_tag (txn_id,tag_id) VALUES (?,?)", (rid, dave))
db.commit()
assert close(one("SELECT net FROM v_owed WHERE person='Dave'")["net"], 100)
assert close(one("SELECT income FROM v_month WHERE month='2026-12'")["income"], 0), \
    "a repayment is not income either"

print("ok — hours, HR export, valuations, lending")
print("ok — model, matching, import and tax")

# === the API's trust boundary ================================================
assert len(api.route(db, "GET", ["v", "v_month"], {}, None)[1]) >= 1
expect(404, lambda: api.route(db, "GET", ["t", "txn; DROP TABLE txn"], {}, None), "injected name")
expect(404, lambda: api.route(db, "GET", ["t", "sqlite_master"], {}, None), "internal table")
expect(400, lambda: api.route(db, "GET", ["t", "txn"], {"nope": ["1"]}, None), "unknown column")
expect(400, lambda: api.route(db, "GET", ["t", "txn"],
                              {"order": ["1); DROP TABLE txn --"]}, None), "injected order")
expect(400, lambda: api.route(db, "POST", ["t", "txn"], {}, {"evil": 1}), "unknown column write")
expect(405, lambda: api.route(db, "POST", ["v", "v_month"], {}, {}), "write to a view")
expect(400, lambda: api.route(db, "GET", ["t", "v_month"], {}, None), "view as table")
expect(400, lambda: api.route(db, "DELETE", ["t", "txn"], {}, None), "unfiltered delete")
assert db.execute("SELECT COUNT(*) FROM txn").fetchone()[0] > 0, "nothing was dropped"

print("ok — api validation")

# === v3: nothing guessed, everything editable, everything undoable ============
BK = os.path.join(tmp.name, "bk")
ADMIN = api.Ctx(True, DB, BK, app=money)
R = lambda m, path, body=None, q=None, ctx=None: \
    api.route(db, m, [x for x in path.split("/") if x], q or {}, body, ctx or api.Ctx(False, DB, BK, app=money))[1]

# a partial edit must not trip NOT NULL on columns it did not send
sid_ = db.execute("SELECT id FROM shift ORDER BY id LIMIT 1").fetchone()[0]
was_end = one("SELECT end FROM shift WHERE id=?", sid_)["end"]
R("POST", "t/shift", {"id": sid_, "end": "18:00"})
assert one("SELECT end FROM shift WHERE id=?", sid_)["end"] == "18:00"
# every edit can be undone, the latest first
assert "Edited shift" in R("POST", "undo")["undid"]
assert one("SELECT end FROM shift WHERE id=?", sid_)["end"] == was_end
# a delete comes back whole, with the rows that hung off it
cat_ = R("POST", "t/category", {"name": "Temp"})["ids"][0]
kid_ = R("POST", "t/category", {"name": "Child", "parent_id": cat_})["ids"][0]
R("DELETE", f"t/category/{cat_}")
assert not db.execute("SELECT 1 FROM category WHERE id=?", (kid_,)).fetchone(), "cascade"
R("POST", "undo")
assert one("SELECT parent_id FROM category WHERE id=?", kid_)["parent_id"] == cat_

# categories nest to any depth but never inside themselves
g3 = R("POST", "t/category", {"name": "Car 3", "parent_id": kid_})["ids"][0]
assert one("SELECT path, root_name FROM v_category WHERE id=?", g3)["path"] == "Temp · Child · Car 3"
expect(400, lambda: R("POST", "t/category", {"id": cat_, "parent_id": g3}), "a category in its own child")
# deleting a category moves its children up rather than losing them
R("DELETE", f"category/{kid_}")
assert one("SELECT parent_id FROM category WHERE id=?", g3)["parent_id"] == cat_
R("POST", "undo")
assert one("SELECT parent_id FROM category WHERE id=?", g3)["parent_id"] == kid_
# a budget covers everything beneath it: both Tesco imports and the market stall
db.execute("UPDATE category SET budget=300 WHERE id=3")
bud = one("SELECT * FROM v_budget WHERE category_id=3 AND month='2026-07'")
assert close(bud["actual"], 280) and close(bud["variance"], -20), dict(bud)   # 120 + 120 + 40

# two rows in two accounts, linked by hand, are one movement and never spending
a_ = one("SELECT id FROM txn WHERE description='TO SAVER'")["id"]
b_ = one("SELECT id FROM txn WHERE account_id=3 AND description='FROM BARCLAYS'")["id"]
R("POST", "link", {"a": a_, "b": b_})
lk = one("SELECT linked_account, category_kind FROM v_txn WHERE id=?", a_)
assert lk["linked_account"] == "Santander Saver ISA" and lk["category_kind"] == "transfer", dict(lk)
assert one("SELECT link_id FROM txn WHERE id=?", b_)["link_id"] == a_
R("DELETE", f"link/{a_}")
assert one("SELECT link_id FROM txn WHERE id=?", b_)["link_id"] is None

# a payslip is lines in groups; gross and net are their sums, not typed twice
t_ = R("GET", "payslip/template")
assert [l["code"] for l in t_["lines"]][:3] == ["basic", "ot15", "ot2"]
amounts = [3000, 150, 50, 400, 150, 100, 50, 300, 90]
lines = [dict(l, amount=x) for l, x in zip(t_["lines"], amounts)]
out = R("POST", "payslip", dict(t_["payslip"], pay_date="2026-10-17", worked_month="2026-09", lines=lines))
tot = out["totals"]
assert close(tot["gross"], 3200) and close(tot["deductions"], 700) and close(tot["net"], 2500), tot
assert close(tot["employer"], 390) and close(tot["tax"], 400)
assert close(tot["ot15_pay"], 150) and close(tot["ot2_pay"], 50) and close(tot["overtime_pay"], 200)
# moving the pay date carries its lines with it, and the next template copies it
R("POST", "payslip", dict(out["payslip"], pay_date="2026-10-16", was="2026-10-17", lines=out["lines"]))
# a new payslip never lands on one already saved: it used to replace it without a word
expect(409, lambda: R("POST", "payslip", dict(t_["payslip"], pay_date="2026-10-16", new=True, lines=lines)), "new over saved")
assert one("SELECT COUNT(*) n FROM payslip_line WHERE pay_date='2026-10-16'")["n"] == 9
assert one("SELECT COUNT(*) n FROM payslip_line WHERE pay_date='2026-10-16'")["n"] == 9
assert not db.execute("SELECT 1 FROM payslip WHERE pay_date='2026-10-17'").fetchone()
assert R("GET", "payslip/template")["payslip"]["pay_date"] == "2026-11-17"
pp = one("SELECT * FROM v_pay_period WHERE month='2026-09'")
assert pp["pay_date"] == "2026-10-16" and close(pp["net"], 2500), dict(pp)
# a query-string number matches a computed column
assert R("GET", "v/v_tax_year", q={"tax_year": ["2026"]}), "tax_year=2026 must match"

# bank holidays are worked out for any year, and match the ones written out for 2025-2030
import re as _re  # noqa: E402
_sql = open(os.path.join(ROOT, "apps/money/migrations/001_money.sql")).read()
_table = set(_re.findall(r"\('(\d{4}-\d\d-\d\d)','((?:[^']|'')*)'\)", _sql[_sql.index("INSERT INTO bank_holiday"):_sql.index("-- Days off.")]))
assert _table == {(d.isoformat(), n.replace("'", "''")) for y in range(2025, 2031) for d, n in money.bank_holidays(y)}
assert ("2022-09-19", "State Funeral of Queen Elizabeth II") in {(d.isoformat(), n) for d, n in money.bank_holidays(2022)}
assert one("SELECT COUNT(*) n FROM bank_holiday WHERE date LIKE '2019-%'")["n"] == 8, "earlier years filled on start"
R("DELETE", "t/bank_holiday/2040-12-25") if db.execute("SELECT 1 FROM bank_holiday WHERE date='2040-12-25'").fetchone() else None
assert R("POST", "bank_holidays/2040")["added"] == 1 and R("POST", "bank_holidays/2040")["added"] == 0
expect(400, lambda: R("POST", "bank_holidays/40"), "a year of two digits")
# a sort code is tidied to 20-45-77 and names its bank, unless you named it
assert money.format_sort_code("204577") == "20-45-77" and money.format_sort_code(" 20 45 77 ") == "20-45-77"
assert [money.bank_for_sort_code(x) for x in ("20-45-77", "09-01-28", "72-00-01", "60-83-71", "04-00-04", "00-00-00")] == \
    ["Barclays", "Santander", "Santander", "Starling Bank", "Monzo", None]
acc_ = R("POST", "t/account", {"name": "Sort code test", "kind": "current", "sort_code": "400530"})
got = one("SELECT sort_code, provider FROM account WHERE name='Sort code test'")
assert tuple(got) == ("40-05-30", "HSBC"), tuple(got)
R("POST", "t/account", {"id": got and one("SELECT id FROM account WHERE name='Sort code test'")["id"], "provider": "First Direct", "sort_code": "40-47-84"})
assert one("SELECT provider FROM account WHERE name='Sort code test'")["provider"] == "First Direct", "yours stands"
expect(400, lambda: R("POST", "t/account", {"name": "Bad code", "kind": "current", "sort_code": "12345"}), "five digits")
db.execute("DELETE FROM account WHERE name='Sort code test'"); db.commit()

# holidays: the substitute days, not the weekend dates
bh = {r[0] for r in db.execute("SELECT date FROM bank_holiday")}
assert {"2026-12-28", "2027-12-27", "2027-12-28", "2028-01-03"} <= bh
assert not {"2026-12-26", "2027-12-25", "2027-12-26"} & bh
R("POST", "t/leave", {"from_date": "2026-08-10", "to_date": "2026-08-14", "days": 5})
R("POST", "t/leave", {"from_date": "2026-11-02", "to_date": "2026-11-02", "days": 0.5})
R("POST", "t/leave_year", {"year": 2026, "extra": 2})
ly = one("SELECT * FROM v_leave_year WHERE year=2026")
assert close(ly["taken"], 5.5) and close(ly["remaining"], 21.5) and ly["bank_holidays"] == 8, dict(ly)

# structure and tools need a signed-in session; the data does not
expect(401, lambda: R("POST", "t/layout", {"page": "x", "panels": "[]"}), "layout without signing in")
expect(401, lambda: R("GET", "admin/health"), "tools without signing in")
# reads run read-only, so nothing writes through a SELECT or a WITH
assert R("POST", "admin/sql", {"sql": "SELECT COUNT(*) FROM txn"}, ctx=ADMIN)["rows"][0][0] > 0
expect(400, lambda: R("POST", "admin/sql", {"sql": "WITH x AS (SELECT 1) DELETE FROM tag"}, ctx=ADMIN),
       "a write dressed as a read")
w_ = R("POST", "admin/sql", {"sql": "UPDATE tag SET note='x' WHERE name='Dave'"}, ctx=ADMIN)
assert w_["changed"] == 1 and os.path.exists(os.path.join(BK, w_["backup"])), "writes back up first"
expect(400, lambda: R("POST", "admin/sql", {"sql": "UPDATE nope SET x=1"}, ctx=ADMIN), "bad SQL")
# a column you add is on the API at once; a formula column computes and cannot be written
R("POST", "admin/columns", {"table": "shift", "name": "Miles", "type": "number"}, ctx=ADMIN)
R("POST", "t/shift", {"id": sid_, "x_miles": 42})
R("POST", "admin/columns", {"table": "shift", "name": "Mileage pay", "type": "number",
                            "formula": "x_miles * 0.45"}, ctx=ADMIN)
assert close(one("SELECT x_mileage_pay FROM shift WHERE id=?", sid_)[0], 18.9)
assert any(c["name"] == "x_miles" for c in R("GET", "meta")["tables"]["shift"])
expect(400, lambda: R("POST", "t/shift", {"id": sid_, "x_mileage_pay": 1}), "formula columns are computed")
expect(400, lambda: R("DELETE", "admin/columns/shift/date", ctx=ADMIN), "built-in columns stay")
R("DELETE", "admin/columns/shift/x_mileage_pay", ctx=ADMIN)
# a saved query becomes a view any panel can chart; one that does not run is refused
R("POST", "admin/views", {"name": "Big spend", "sql": "SELECT * FROM v_spend WHERE amount > 100"}, ctx=ADMIN)
assert R("GET", "v/cv_big_spend")
expect(400, lambda: R("POST", "admin/views", {"name": "bad", "sql": "SELECT * FROM nope"}, ctx=ADMIN), "broken view")
# restore puts the file back as it was, after backing up the present
name_ = R("POST", "admin/backup", {}, ctx=ADMIN)["name"]
assert name_ in {f["name"] for f in R("GET", "admin/backups", ctx=ADMIN)["files"]}
db.execute("UPDATE tag SET note='changed' WHERE name='Dave'"); db.commit()
R("POST", "admin/restore", {"name": name_}, ctx=ADMIN)
assert one("SELECT note FROM tag WHERE name='Dave'")["note"] == "x"
expect(404, lambda: R("POST", "admin/restore", {"name": "../../etc/passwd"}, ctx=ADMIN), "restore traversal")

print("ok — undo, links, payslips, holidays, admin")

# === v3.1: pension, overtime rates, holiday types, figures for formulas ========
# a pension account takes both sides of every payslip's pension lines
nest = R("POST", "t/account", {"name": "NEST", "kind": "pension", "colour": "#7d4fc7", "provider": "NEST"})["ids"][0]
R("POST", "t/valuation", {"account_id": nest, "date": "2026-10-31", "value": 500})
pen = one("SELECT * FROM v_pension WHERE id=?", nest)
assert close(pen["from_you"], 100) and close(pen["from_employer"], 90), dict(pen)   # the 2026-10-16 payslip
assert close(pen["paid_in"], 190) and close(pen["gain"], 310) and pen["colour"] == "#7d4fc7"
# a transfer into it from the bank counts too, and is saving not spending
R("POST", "t/txn", {"account_id": nest, "date": "2026-10-20", "description": "SIPP TOP UP", "amount": 50})
assert close(one("SELECT paid_in FROM v_pension WHERE id=?", nest)["paid_in"], 240)
assert one("SELECT tax_year FROM v_pension_flow WHERE source='you'")["tax_year"] == 2026

# the estimate splits overtime by rate, and so does the payslip
est = tax.month_estimate(db, "2026-09")
assert close(est["ot15_hours"] + est["ot2_hours"], est["ot_hours"]) and est["ot2_hours"] > 0, est
assert close(est["ot15_pay"] + est["ot2_pay"], est["overtime_pay"])
# short weekdays can count against overtime, the way the pay sheet adds it up
per_day = one("SELECT SUM(ot_hours) h FROM v_day WHERE month='2026-09'")["h"]
db.execute("INSERT INTO shift (date,start,end) VALUES ('2026-09-23','08:00','16:00')")   # Wed, 8h
db.execute("UPDATE setting SET value='1' WHERE key='ot_net'"); db.commit()
netted = one("SELECT SUM(ot_hours) h FROM v_day WHERE month='2026-09'")["h"]
assert close(netted, per_day - 1.0), (per_day, netted)   # the new 8h Wednesday and the 8h Tuesday night
assert close(one("SELECT excess FROM v_day WHERE date='2026-09-23'")["excess"], -0.5)
db.execute("UPDATE setting SET value='0' WHERE key='ot_net'"); db.commit()
assert close(one("SELECT SUM(ot_hours) h FROM v_day WHERE month='2026-09'")["h"], per_day)

# time off in lieu: hours earned become days in the allowance; days booked as lieu come off it
R("POST", "t/leave", {"from_date": "2026-12-01", "to_date": "2026-12-01", "days": 1, "kind": "extra"})
ly2 = one("SELECT * FROM v_leave_year WHERE year=2026")
assert close(ly2["taken"], 5.5) and close(ly2["extra_taken"], 1) and close(ly2["remaining"], 20.5), dict(ly2)
db.execute("UPDATE setting SET value='7.5' WHERE key='leave_day_hours'"); db.commit()
R("POST", "t/leave_year", {"year": 2026, "toil_hours": 15})
ly2 = one("SELECT * FROM v_leave_year WHERE year=2026")
assert close(ly2["toil_days"], 2) and close(ly2["total"], 29) and close(ly2["remaining"], 22.5) and close(ly2["toil_left"], 7.5), dict(ly2)
db.execute("UPDATE setting SET value='' WHERE key='leave_day_hours'"); db.commit()
assert close(one("SELECT day_hours FROM v_leave_year WHERE year=2026")["day_hours"],
             float(one("SELECT value FROM setting WHERE key='weekly_contract_hours'")["value"]) / 5)

# savings, investments and pensions: a savings account known only by a valuation still counts
from core import pdftext   # noqa: E402
from apps.money import statement   # noqa: E402
sav = R("POST", "t/account", {"name": "Premium Bonds", "kind": "savings"})["ids"][0]
R("POST", "t/valuation", {"account_id": sav, "date": "2026-09-01", "value": 1500})
h = one("SELECT * FROM v_holding WHERE id = ?", sav)
assert (h["value"], h["basis"], h["paid_in"], h["gain"], h["grp"]) == (1500, "valuation", None, None, "Savings"), dict(h)
R("POST", "t/contribution", {"account_id": sav, "date": "2026-08-01", "amount": 1400})
assert close(one("SELECT gain FROM v_holding WHERE id = ?", sav)["gain"], 100)
# a payslip's contributions can go to another pension
pot2 = R("POST", "t/account", {"name": "Old scheme", "kind": "pension"})["ids"][0]
slip = one("SELECT pay_date FROM payslip_line WHERE code = 'pension' LIMIT 1")["pay_date"]
R("POST", "t/payslip", {"pay_date": slip, "pension_account_id": pot2})
assert one("SELECT COUNT(*) n FROM v_pension_flow WHERE ref = ? AND account_id = ?", slip, pot2)["n"] >= 1
db.execute("DELETE FROM account WHERE id IN (?, ?)", (sav, pot2)); db.commit()
# statement PDFs: three makers (Chrome, Chrome packed into object streams, reportlab's simple fonts)
FX = os.path.join(ROOT, "tests", "fixtures")
for f in ("statement-t212.pdf", "statement-objstm.pdf"):
    got = statement.read(open(os.path.join(FX, f), "rb").read(),
                         [{"id": 7, "name": "Trading 212 ISA", "provider": "Trading 212", "kind": "investment"},
                          {"id": 8, "name": "Nest", "provider": "Nest", "kind": "pension"}])
    assert (got["value"], got["date"], got["deposits"], got["withdrawals"], got["account_id"]) == (11346.97, "2026-08-31", 500, 0, 7), got
    assert got["period"] == ["2026-08-01", "2026-08-31"] and got["value_label"] == "account value"
simple = statement.parse(pdftext.text(open(os.path.join(FX, "statement-simple.pdf"), "rb").read()))
assert (simple["value"], simple["date"], simple["provider"]) == (45678.90, "2026-06-30", "Aviva"), simple
assert statement.parse("Opening balance £1,000.00\nClosing balance £1,200.50\nAs at 5 April 2026")["value"] == 1200.50
expect(422, lambda: R("POST", "valuations/read", {"data": "data:application/pdf;base64,SGVsbG8="}), "not a PDF")
print("ok — savings, investments, pensions and statement PDFs")

# figures by name and period, for 2026.May.Hours in a formula
vals = R("POST", "measures", {"refs": [{"name": "hours", "from": "2026-09-01", "to": "2026-09-30"},
                                       {"name": "Gross", "from": "2026-10-01", "to": "2026-10-31"},
                                       {"name": "nonsense"}]})["values"]
assert close(vals[0], one("SELECT SUM(hours) h FROM v_day WHERE month='2026-09'")["h"]) and close(vals[1], 3200)
assert "error" in vals[2]
assert any(m["name"] == "Overtime2" for m in R("GET", "measures"))

# your own wording is structure: it needs a signed-in session
expect(401, lambda: R("POST", "t/ui_text", {"original": "Timesheet", "text": "Hours sheet"}), "wording without signing in")
R("POST", "t/ui_text", {"original": "Timesheet", "text": "Hours sheet"}, ctx=ADMIN)
assert R("GET", "meta")["text"]["Timesheet"] == "Hours sheet"
print("ok — pension, overtime rates, holiday types, figures, wording")

# === a new payslip: empty lines, basic and the overtime rates as hints ==========
tpl = R("GET", "payslip/template")
ot = {l["code"]: l for l in tpl["lines"] if l["code"] in ("basic", "ot15", "ot2")}
assert all(l["amount"] is None and l["qty"] is None for l in tpl["lines"]), "no 0.00 to type over"
annual, hourly = money.pay_rates(db, tpl["payslip"]["pay_date"])
assert close(ot["basic"]["hint"]["amount"], annual / 12) and close(ot["ot15"]["hint"]["rate"], hourly * 1.5)
assert close(ot["ot2"]["hint"]["rate"], hourly * 2) and "qty" not in ot["ot15"]["hint"]
assert tpl["payslip"]["worked_month"] == money._prev_month(tpl["payslip"]["pay_date"])
assert money._prev_month("2027-01-17") == "2026-12"
# in the UK a comma groups thousands: 24,000 on a payslip is twenty-four thousand
assert api._maybe_float("24,000") == 24000 and api._maybe_float("£1,234.50") == 1234.5 and api._maybe_float("x") is None
print("ok — payslip overtime lines")

# === reminders, regular bills, search, the tax year, switching databases ==========
from datetime import date   # noqa: E402
assert reminders.nth("2026-01-31", "month", 1) == date(2026, 2, 28)       # the 31st falls to the 28th...
assert reminders.nth("2026-01-31", "month", 2) == date(2026, 3, 31)       # ...and comes back
netflix = matching.ensure_merchant(db, "Netflix", 3)
for d in ("2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"):
    db.execute("INSERT INTO txn (account_id,date,description,amount,merchant_id,merchant_locked) VALUES (1,?,?,?,?,1)",
               (d, "NETFLIX.COM", -10.99, netflix))
db.commit()
sug = {x["name"]: x for x in reminders.suggest(db, today=date(2026, 9, 20))}
assert sug["Netflix"]["every"] == "month" and sug["Netflix"]["next"] == "2026-10-01", sug
assert "Tesco" not in sug                                                   # once is not a habit
R("POST", "t/reminder", {"title": "Netflix", "start": "2026-10-01", "every": "month", "amount": 10.99, "merchant_id": netflix})
R("POST", "t/reminder", {"title": "MOT", "start": "2026-09-10", "every": "once"})
up = {r["title"]: r for r in reminders.upcoming(db, today=date(2026, 9, 20))}
assert up["Netflix"]["next_due"] == "2026-10-01" and up["Netflix"]["days"] == 11 and up["Netflix"]["last_paid"] == "2026-09-01"
assert up["MOT"]["days"] == -10                                             # overdue until ticked off
assert "Netflix" not in {x["name"] for x in reminders.suggest(db, today=date(2026, 9, 20))}
db.execute("INSERT INTO txn (account_id,date,description,amount,merchant_id,merchant_locked) VALUES (1,'2026-09-30','NETFLIX.COM',-10.99,?,1)", (netflix,))
R("POST", "t/reminder", {"id": up["MOT"]["id"], "done_through": "2026-09-10"})
up = {r["title"]: r for r in reminders.upcoming(db, today=date(2026, 10, 3))}
assert up["Netflix"]["next_due"] == "2026-11-01", up["Netflix"]               # paid a day early: settled
assert up["MOT"]["next_due"] is None

# search: every word somewhere in the row; a number finds the amount
S = lambda q: {g["kind"]: g["rows"] for g in api.search(db, money.SEARCH, q)}
found = S("tesco")
assert any("TESCO" in r["description"] for r in found["txn"]) and found["payee"][0]["name"] == "Tesco"
assert [r["description"] for r in S("218")["txn"]] == ["BLACK HORSE FINANCE"]
assert not S("tesco horse") and not S("   ")
assert not S("%")                                                          # a % is a character, not a wildcard
assert R("GET", "search", q={"q": ["netflix"]})[0]["kind"] == "txn"         # and on the API

# the end of the tax year: payslips added up, beside the P60
chk = tax.year_check(db, 2026)
assert chk["payslips"] >= 1 and close(chk["taxable"], chk["gross"] - chk["pension"]) and chk["expected_tax"] is not None
assert all(m <= date.today().isoformat()[:7] for m in chk["missing"])     # months still to come are not missing
R("POST", "t/p60", {"tax_year": 2026, "pay": 1234.5, "tax_code": "1257L"})
assert tax.year_check(db, 2026)["p60"]["pay"] == 1234.5

# switching databases: inspected read-only first, the one left behind backed up.
# One password covers everything now, so the file's own is not asked for.
other = os.path.join(tmp.name, "other.db")
_db.open_db(other, money, quiet=True).close()
now = {"path": DB}
SW = api.Ctx(True, DB, BK, switch=lambda path: now.update(path=path), app=money)
open(os.path.join(tmp.name, "log.db"), "w").close()                         # another app's file is not offered
listed = {f["name"]: f for f in R("GET", "admin/db", ctx=SW)["files"]}
assert listed["t.db"]["current"] and not listed["other.db"]["current"] and "log.db" not in listed
info = R("GET", "admin/db/inspect", q={"path": [other]}, ctx=SW)
assert info["problem"] is None and dict(info["facts"])["Transactions"] == "0"
expect(400, lambda: R("POST", "admin/db/switch", {"path": DB}, ctx=SW), "already open")
expect(400, lambda: R("GET", "admin/db/inspect", q={"path": [os.path.join(ROOT, "README.md")]}, ctx=SW), "not a .db")
junk = os.path.join(tmp.name, "junk.db"); open(junk, "w").write("not a database, just text " * 100)
assert "cannot be read" in R("GET", "admin/db/inspect", q={"path": [junk]}, ctx=SW)["problem"]
alien = os.path.join(tmp.name, "alien.db")
a_ = sqlite3.connect(alien); a_.execute("CREATE TABLE schema_version (n INTEGER PRIMARY KEY, filename TEXT, app_version TEXT)")
a_.execute("INSERT INTO schema_version VALUES (1, 'x', '2')"); a_.commit(); a_.close()
assert "not a Money database" in R("GET", "admin/db/inspect", q={"path": [alien]}, ctx=SW)["problem"]
assert R("POST", "admin/db/switch", {"path": other}, ctx=SW)["db"] == "other.db"
assert now["path"] == other
assert any("switch" in f for f in os.listdir(BK))                           # the one left behind was backed up
R("POST", "admin/db/new", {"name": "sandbox", "copy": True}, ctx=SW)
sand = os.path.join(tmp.name, "sandbox.db")
assert now["path"] == sand and sqlite3.connect(sand).execute("SELECT COUNT(*) FROM txn").fetchone()[0] > 0
expect(409, lambda: R("POST", "admin/db/new", {"name": "sandbox"}, ctx=SW), "exists")
expect(400, lambda: R("POST", "admin/db/new", {"name": "../escape"}, ctx=SW), "a path, not a name")
future = os.path.join(tmp.name, "future2.db")
f2 = _db.open_db(future, money, quiet=True); f2.execute("INSERT INTO schema_version (n, filename, app_version) VALUES (999,'x','9')"); f2.commit(); f2.close()
assert "newer" in R("GET", "admin/db/inspect", q={"path": [future]}, ctx=SW)["problem"]
expect(401, lambda: R("GET", "admin/db"), "signed in only")
print("ok — reminders, bills, search, tax year, switching databases")

# an emptied setting is kept as '' ("the first pension account"), not refused as NULL
R("POST", "t/setting", {"key": "pension_account", "value": ""})
R("POST", "t/setting", {"key": "brand_new_setting", "value": ""})
assert one("SELECT value FROM setting WHERE key='pension_account'")["value"] == ""
assert one("SELECT value FROM setting WHERE key='brand_new_setting'")["value"] == ""

# === safe to spend until payday: only what was typed ================================
S2 = os.path.join(tmp.name, "safe.db")
sd = _db.open_db(S2, money, quiet=True)
sd.executescript("""
INSERT INTO account (id, name, kind) VALUES (1, 'Current', 'current'), (2, 'Saver', 'savings'), (3, 'Joint', 'current');
INSERT INTO statement (account_id, filename, period_start, period_end, closing_balance, role)
  VALUES (1, 'sep.csv', '2026-09-01', '2026-09-20', 1000, 'current'), (3, 'j.csv', '2026-09-01', '2026-09-21', 400, 'current');
INSERT INTO reminder (title, start, every, amount) VALUES
  ('Netflix', '2026-10-01', 'month', 10.99), ('Cleaner', '2026-09-25', 'week', 20),
  ('MOT', '2026-10-10', 'once', 54.85), ('Insurance', '2026-10-20', 'year', 300),
  ('Gym', '2026-09-19', 'month', 25);
UPDATE setting SET value = '100' WHERE key = 'safe_savings';
""")
sd.commit()
T = date(2026, 9, 22)
sf = money.safe(sd, T)
# before payday (17 Oct) and after the balance's date (20 Sep): Netflix, four cleans, the MOT.
# The gym on 19 Sep is before the statement closed, so it is already in that balance; insurance is after payday.
assert sf["payday"] == "2026-10-17" and sf["days"] == 25 and sf["account"] == "Current"
assert [b["title"] for b in sf["bills"]] == ["Cleaner", "Netflix", "Cleaner", "Cleaner", "MOT", "Cleaner"], sf["bills"]
assert close(sf["bills_total"], 145.84) and close(sf["available"], 754.16) and close(sf["per_day"], 30.17), sf
assert sf["balance_from"] == "statement" and sf["balance_on"] == "2026-09-20"
# a balance typed today beats the older statement; one typed before the statement does not
sd.execute("UPDATE setting SET value = '900' WHERE key = 'safe_balance'")
sd.execute("UPDATE setting SET value = '2026-09-22' WHERE key = 'safe_balance_on'"); sd.commit()
sf = money.safe(sd, T)
assert sf["balance_from"] == "typed" and close(sf["available"], 900 - 145.84 - 100)
sd.execute("UPDATE setting SET value = '2026-09-01' WHERE key = 'safe_balance_on'"); sd.commit()
assert money.safe(sd, T)["balance_from"] == "statement"
sd.execute("UPDATE setting SET value = '3' WHERE key = 'safe_account'"); sd.commit()
assert money.safe(sd, T)["account"] == "Joint", "the chosen account"
# a bill ticked off is not counted again
sd.execute("UPDATE reminder SET done_through = '2026-10-10' WHERE title = 'MOT'"); sd.commit()
sd.execute("UPDATE setting SET value = '' WHERE key = 'safe_account'"); sd.commit()
assert "MOT" not in [b["title"] for b in money.safe(sd, T)["bills"]]
# on payday itself, the next one is a month away
assert money.next_payday(sd, date(2026, 10, 17)) == date(2026, 11, 17) and money.next_payday(sd, date(2026, 12, 20)) == date(2027, 1, 17)
sd.execute("DELETE FROM statement"); sd.execute("UPDATE setting SET value = '' WHERE key = 'safe_balance'"); sd.commit()
assert money.safe(sd, T)["available"] is None, "no balance typed means no figure, not a guess"
h = money.home(sd)
assert [f["label"] for f in h["figures"]] == ["Safe to spend", "Payday", "Hours this week"] and "items" in h
sd.close()
print("ok — safe to spend, Home card")

# === receipts: a photo or a PDF, with its payment or waiting for one ================
PDF, JPEG = "data:application/pdf;base64,JVBERi0xLjQK", "data:image/jpeg;base64,/9j/4AAQ"
tid = one("SELECT id FROM txn WHERE description='BLACK HORSE FINANCE'")["id"]
rid = R("POST", "t/receipt", {"txn_id": tid, "image": JPEG, "thumb": JPEG, "note": "car finance statement"})["ids"][0]
R("POST", "t/receipt", {"txn_id": tid, "image": PDF})
got = R("GET", "receipts/of", q={"txn_ids": [str(tid)]})[str(tid)]
assert [bool(r["pdf"]) for r in got] == [False, True] and "image" not in got[0]
for bad in ({"image": "data:image/png;base64,iVBOR"}, {"image": "data:text/html;base64,PGI+"},
            {"image": "data:application/pdf;base64," + "A" * 14_000_001}):
    try:
        R("POST", "t/receipt", bad); raise SystemExit(f"FAIL: accepted a receipt {bad['image'][:30]}")
    except sqlite3.IntegrityError:
        db.rollback()
# kept before the payment shows: found again by amount and date, linked by hand
wait = R("POST", "t/receipt", {"image": JPEG, "date": "2026-07-16", "amount": 218, "note": "paid at the dealer"})["ids"][0]
assert [r["id"] for r in R("GET", "v/v_receipt", q={"txn_id": [""]})] == [wait]
m_ = R("GET", f"receipts/{wait}/matches")
assert [x["id"] for x in m_] == [], "the only £218 payment already has a receipt"
R("DELETE", f"t/receipt/{rid}"); db.execute("DELETE FROM receipt WHERE txn_id = ?", (tid,)); db.commit()
assert [x["id"] for x in R("GET", f"receipts/{wait}/matches")] == [tid]
R("POST", "t/receipt", {"id": wait, "txn_id": tid})
assert {g["kind"]: g["rows"] for g in api.search(db, money.SEARCH, "dealer")}["receipt"][0]["id"] == wait
# a receipt goes with its payment, and undo brings both back
R("DELETE", f"t/txn/{tid}")
assert not one("SELECT 1 FROM receipt WHERE id=?", wait)
R("POST", "undo")
assert one("SELECT txn_id FROM receipt WHERE id=?", wait)["txn_id"] == tid
print("ok — receipts")

# === the calendar feed's events ===================================================
ev = money.calendar(db, "2026-09-01", "2026-12-31")
uids = [e["uid"] for e in ev]
assert len(uids) == len(set(uids)) and "payday-2026-10-17" in uids and "bank-2026-12-25" in uids
assert any(e["title"] == "Netflix £10.99" and e["date"] == "2026-11-01" for e in ev), [e for e in ev if "Netflix" in e["title"]]
assert any(e["uid"].startswith("leave-") and e.get("end") for e in ev)
assert ev == money.calendar(db, "2026-09-01", "2026-12-31"), "the same events every time"
print("ok — calendar events")

# === backups and recovery ====================================================
with tempfile.TemporaryDirectory() as t2:
    live = os.path.join(t2, "l.db")
    d2 = _db.open_db(live, money, quiet=True)
    d2.execute("INSERT INTO tag (name) VALUES ('keepme')")
    d2.commit()
    d2.close()
    elsewhere = os.path.join(t2, "on-the-pc")
    _db.back_up(live, elsewhere)
    kept = os.listdir(elsewhere)
    assert len(kept) == 1
    restored = sqlite3.connect(os.path.join(elsewhere, kept[0]))
    assert restored.execute("SELECT 1 FROM tag WHERE name='keepme'").fetchone()
    restored.close()
    _db.back_up(live, elsewhere)
    assert len(os.listdir(elsewhere)) == 1, "one copy a day, not one per start"
    # a big database (a photo-heavy log) is copied once a week, and fewer copies are kept
    was = _db.BIG
    _db.BIG = 1
    for f in os.listdir(elsewhere):
        os.rename(os.path.join(elsewhere, f), os.path.join(elsewhere, "l.db.2000-01-01"))   # an old copy
    _db.back_up(live, elsewhere)
    assert len(os.listdir(elsewhere)) == 2, "no copy this week yet: one is made"
    _db.back_up(live, elsewhere, label="manual")
    for i in range(12):
        open(os.path.join(elsewhere, f"l.db.1999-01-{i + 1:02d}"), "w").close()
    _db.back_up(live, elsewhere, label="again")
    assert len(os.listdir(elsewhere)) == _db.KEEP_BIG, os.listdir(elsewhere)
    _db.BIG = was

    with open(live, "r+b") as f:
        f.seek(8192)
        f.write(b"\xde\xad\xbe\xef" * 500)
    try:
        _db.check_integrity(live)
        raise SystemExit("FAIL: a damaged database was accepted")
    except _db.Stop as e:
        assert "damaged" in str(e)

# an old app must refuse a newer database rather than corrupting it
with tempfile.TemporaryDirectory() as t3:
    p3 = os.path.join(t3, "future.db")
    d3 = _db.open_db(p3, money, quiet=True)
    d3.execute("INSERT INTO schema_version (n, filename, app_version) VALUES (999,'x','9')")
    d3.commit()
    try:
        _db.migrate(d3, money)
        raise SystemExit("FAIL: an old app accepted a newer schema")
    except _db.Stop as e:
        assert "newer" in str(e) or "only knows" in str(e), str(e)
    d3.close()

print("ok — backups and versioning")

# 2.2 → 3.0: the old all-time lieu hours (earned less used) land in this year
import shutil, types      # noqa: E402,E401
with tempfile.TemporaryDirectory() as t4:
    os.makedirs(os.path.join(t4, "m"))
    shutil.copy(os.path.join(money.MIGRATIONS, "001_money.sql"), os.path.join(t4, "m"))
    p4 = os.path.join(t4, "old.db")
    d4 = _db.connect(p4)
    _db.migrate(d4, types.SimpleNamespace(NAME="money", MIGRATIONS=os.path.join(t4, "m"), VIEWS=None), log=lambda *_: None)
    d4.execute("UPDATE setting SET value = '10' WHERE key = 'toil_earned'")
    d4.execute("UPDATE setting SET value = '3' WHERE key = 'toil_used'")
    d4.commit(); d4.close()
    d4 = _db.open_db(p4, money, quiet=True)
    y = int(date.today().strftime("%Y"))
    assert close(d4.execute("SELECT toil_hours FROM leave_year WHERE year = ?", (y,)).fetchone()[0], 7)
    d4.close()
print("ok — time off in lieu moves to the leave year")
# === Trading 212's history CSV: payments in and out, each once ===================================
T212 = """Action,Time,ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total)
Deposit,2026-01-05 09:00:01,,,,,dep-1,,,,,,,500.00,GBP
Market buy,2026-01-05 10:12:00,IE00B3XXRP09,VUSA,Vanguard S&P 500,,EOF1,5.2,85.10,GBP,1.00,,,442.52,GBP
Dividend (Dividend),2026-03-20 12:00:00,IE00B3XXRP09,VUSA,Vanguard S&P 500,,,5.2,0.21,USD,0.79,,,0.86,GBP
Interest on cash,2026-03-31 23:00:00,,,,,int-1,,,,,,,0.14,GBP
Withdrawal,2026-04-02 08:00:00,,,,,wd-1,,,,,,,-150.00,GBP
Deposit,2026-04-10 08:00:00,,,,,dep-usd,,,,,,,100.00,USD
Market sell,2026-05-01 14:00:00,IE00B3XXRP09,VUSA,Vanguard S&P 500,,EOF2,1,90.00,GBP,1.00,4.9,GBP,90.00,GBP
"""
acc = db.execute("INSERT INTO account (name, kind) VALUES ('T212 check ISA', 'investment')").lastrowid
db.commit()
plan = R("POST", "t212/plan", {"account_id": acc, "text": T212})
assert [(x["date"], x["amount"]) for x in plan["new"]] == [("2026-01-05", 500.0), ("2026-04-02", -150.0)], plan["new"]
assert plan["dividends"] == 0.86 and plan["interest"] == 0.14 and plan["buys"] == 1 and plan["sells"] == 1
assert len(plan["foreign"]) == 1 and plan["first"] == "2026-01-05" and plan["last"] == "2026-05-01"
assert R("POST", "t212/commit", {"account_id": acc, "text": T212})["added"] == 2
assert R("POST", "t212/commit", {"account_id": acc, "text": T212})["added"] == 0, "the same file twice adds nothing"
assert db.execute("SELECT SUM(amount) FROM contribution WHERE account_id = ?", (acc,)).fetchone()[0] == 350.0
api.undo(db, ctx=ADMIN)
assert db.execute("SELECT COUNT(*) FROM contribution WHERE account_id = ?", (acc,)).fetchone()[0] == 0, "undo takes the import back"
expect(400, lambda: api.route(db, "POST", ["t212", "plan"], {}, {"account_id": 1, "text": T212}, ADMIN), "a current account")
expect(422, lambda: api.route(db, "POST", ["t212", "plan"], {}, {"account_id": acc, "text": "Date,Amount\n1,2"}, ADMIN), "not a T212 file")
print("ok — Trading 212 CSV: deposits and withdrawals once each, dividends and interest shown, other currencies left out")

db.close()
tmp.cleanup()
print("\nok — all checks passed")
