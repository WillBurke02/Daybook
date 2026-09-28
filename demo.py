"""Throwaway sample data for every app, so Daybook can be looked at before real
data goes in.

    python3 demo.py demo-data
    python3 daybook.py serve --data demo-data

The password is the default, pass.
"""
import os
import random
import shutil
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import db as _db, suite  # noqa: E402

folder = sys.argv[1] if len(sys.argv) > 1 else "demo-data"
if os.path.isdir(folder):
    shutil.rmtree(folder)
suite.setup(folder)
suite.open_store().close()
APPS = suite.SUITE.apps
random.seed(11)


# ============================================================================ Money
def money():
    from apps.money import matching
    db = _db.open_db(suite.path("money"), APPS["money"], quiet=True, no_backup=True)
    db.executescript("""
INSERT INTO account (name,kind,last4,opening,share_pct,colour,provider) VALUES
 ('Barclays Current','current','4417',1850,100,'#00aeef',NULL),
 ('Santander Joint','current','9982',640,50,'#ec0000',NULL),
 ('Santander Saver ISA','savings','1123',4200,100,'#f28b82',NULL),
 ('Trading 212 ISA','investment','7740',7300,100,'#3d6ec7',NULL),
 ('NEST pension','pension',NULL,1200,100,'#7d4fc7','NEST');
INSERT INTO valuation (account_id,date,value) VALUES (5,'2026-03-31',3900),(5,'2026-09-01',5230);
INSERT INTO pay_rate (from_date,annual,note) VALUES
 ('2024-04-01',41000,'starting'), ('2026-04-01',45500,'annual review');
INSERT INTO tag (name,kind) VALUES ('Car 1','vehicle'), ('Side job','job'), ('Italy 2026','trip'), ('Dave','person');
INSERT INTO leave (from_date,to_date,days,note) VALUES
 ('2026-04-02','2026-04-02',1,NULL), ('2026-06-12','2026-06-15',2,'Long weekend'),
 ('2026-08-10','2026-08-14',5,'Italy'), ('2026-10-01','2026-10-02',2,NULL);
INSERT INTO leave (from_date,to_date,days,note,kind) VALUES ('2026-07-03','2026-07-03',1,'Extra hours','extra');
UPDATE setting SET value='43.65' WHERE key='toil_earned';
UPDATE setting SET value='8.5' WHERE key='toil_used';
UPDATE setting SET value='75' WHERE key='works_number';
UPDATE setting SET value='150' WHERE key='safe_savings';
UPDATE leave_year SET extra = 3 WHERE year = 2026;
""")

    GROUPS = {
        "Salary":       ("income", None),
        "Moving money": ("transfer", None),
        "Lent out":     ("lending", None),
        "Groceries":    ("spend", 380),
        "Vehicle":      ("spend", 420),
        "Home":         ("spend", 360),
        "Eating out":   ("spend", 120),
        "Shopping":     ("spend", 150),
        "Subscriptions":("spend", 45),
        "Fitness":      ("spend", 30),
    }
    gid = {}
    for name, (kind, budget) in GROUPS.items():
        gid[name] = db.execute("INSERT INTO category (name,kind,budget) VALUES (?,?,?)",
                               (name, kind, budget)).lastrowid
    CHILDREN = {
        "Groceries": ["Tesco", "Aldi", "Co-op"],
        "Vehicle": ["Finance", "Fuel", "Insurance", "Servicing"],
        "Home": ["Energy", "Water", "Council tax", "Broadband", "Phone"],
        "Shopping": ["Amazon", "Screwfix", "Decathlon"],
    }
    cid = {}
    for g, kids in CHILDREN.items():
        for k in kids:
            cid[f"{g}/{k}"] = db.execute(
                "INSERT INTO category (parent_id,name,kind) VALUES (?,?,'spend')",
                (gid[g], k)).lastrowid

    CAR = db.execute("SELECT id FROM tag WHERE name='Car 1'").fetchone()["id"]
    M = {}
    def merch(name, cat, pats, tag=None, internal=0):
        m = matching.ensure_merchant(db, name, cat, internal)
        if tag:
            db.execute("UPDATE merchant SET default_tag=? WHERE id=?", (tag, m))
        for p in pats:
            db.execute("INSERT OR IGNORE INTO match_rule (merchant_id,kind,pattern) "
                       "VALUES (?,'contains',?)", (m, p))
        M[name] = m
        return m

    merch("TS247",           gid["Salary"],       ["TS247"])
    merch("Internal",        gid["Moving money"], ["TO SAVER","TO T212","TO JOINT","FROM BARCLAYS"], internal=1)
    merch("Tesco",           cid["Groceries/Tesco"],   ["TESCO"])
    merch("Aldi",            cid["Groceries/Aldi"],    ["ALDI"])
    merch("Co-op",           cid["Groceries/Co-op"],   ["CO-OP"])
    merch("Black Horse",     cid["Vehicle/Finance"],   ["BLACK HORSE"], CAR)
    merch("Shell",           cid["Vehicle/Fuel"],      ["SHELL"], CAR)
    merch("BP",              cid["Vehicle/Fuel"],      ["BP CONNECT"], CAR)
    merch("Admiral",         cid["Vehicle/Insurance"], ["ADMIRAL"], CAR)
    merch("Octopus Energy",  cid["Home/Energy"],       ["OCTOPUS"])
    merch("Severn Trent",    cid["Home/Water"],        ["SEVERN TRENT"])
    merch("Stoke Council",   cid["Home/Council tax"],  ["COUNCIL TAX"])
    merch("Sky",             cid["Home/Broadband"],    ["SKY BROADBAND"])
    merch("EE",              cid["Home/Phone"],        ["EE MOBILE"])
    merch("Amazon",          cid["Shopping/Amazon"],   ["AMAZON"])
    merch("Screwfix",        cid["Shopping/Screwfix"], ["SCREWFIX"])
    merch("Decathlon",       cid["Shopping/Decathlon"],["DECATHLON"])
    merch("Greggs",          gid["Eating out"],   ["GREGGS"])
    merch("Wetherspoon",     gid["Eating out"],   ["WETHERSPOON"])
    merch("Deliveroo",       gid["Eating out"],   ["DELIVEROO"])
    merch("Netflix",         gid["Subscriptions"],["NETFLIX"])
    merch("Spotify",         gid["Subscriptions"],["SPOTIFY"])
    merch("GitHub",          gid["Subscriptions"],["GITHUB"])
    merch("PureGym",         gid["Fitness"],      ["PUREGYM"])

    FIXED = [("DIRECT DEBIT OCTOPUS ENERGY LTD REF: 88213344", 112.40, 2),
             ("DIRECT DEBIT SEVERN TRENT WATER", 34.10, 2),
             ("DD COUNCIL TAX STOKE", 148.00, 2),
             ("DD SKY BROADBAND", 32.00, 2),
             ("DD EE MOBILE", 21.50, 1),
             ("NETFLIX.COM", 10.99, 1), ("SPOTIFY UK", 11.99, 1),
             ("GITHUB INC", 3.40, 1), ("PUREGYM LTD", 24.99, 1),
             ("BLACK HORSE FINANCE", 218.00, 1), ("ADMIRAL INSURANCE", 50.00, 1)]
    VARIABLE = [("CRD TESCO STORES 3411 ON {d}", 18, 95, 2), ("POS ALDI STOKE *{c}", 22, 70, 2),
                ("CO-OP FOOD HANLEY", 6, 24, 2), ("CONTACTLESS SHELL TRENTHAM GB", 55, 82, 1),
                ("POS BP CONNECT *{c}", 50, 78, 1), ("SQ *GREGGS", 3, 9, 1),
                ("WETHERSPOON STOKE", 14, 38, 1), ("DELIVEROO.CO.UK", 18, 44, 1),
                ("AMAZON.CO.UK*{c}M4", 8, 120, 1), ("SCREWFIX DIRECT 2213", 12, 90, 1),
                ("DECATHLON UK LTD", 20, 75, 1)]

    start, end = date(2025, 10, 1), date(2026, 9, 20)
    d = start
    stmts = {}
    def _eom(month):
        y, mth = int(month[:4]), int(month[5:7])
        nxt = date(y + (mth == 12), 1 if mth == 12 else mth + 1, 1)
        return (nxt - timedelta(days=1)).isoformat()


    def stmt(acc, month):
        key = (acc, month)
        if key not in stmts:
            stmts[key] = db.execute(
                "INSERT INTO statement (account_id,filename,period_start,period_end,"
                "opening_balance,row_count,role,content_hash) VALUES (?,?,?,?,?,0,'history',?)",
                (acc, f"{['','barclays','joint','saver','t212'][acc]}-{month}.csv",
                 month + "-01", _eom(month), 0, f"demo-{acc}-{month}")).lastrowid
        return stmts[key]

    def tx(acc, when, desc, amt):
        sid = stmt(acc, when.strftime("%Y-%m"))
        db.execute("INSERT INTO txn (account_id,date,description,amount,description_norm,statement_id) "
                   "VALUES (?,?,?,?,?,?)",
                   (acc, when.isoformat(), desc, round(amt, 2), matching.normalise(desc), sid))
        db.execute("UPDATE statement SET row_count=row_count+1 WHERE id=?", (sid,))
        return db.execute("SELECT MAX(id) FROM txn").fetchone()[0]

    def link(a, b):
        db.execute("UPDATE txn SET link_id=? WHERE id=?", (b, a))
        db.execute("UPDATE txn SET link_id=? WHERE id=?", (a, b))

    while d <= end:
        if d.day == 1:
            for desc, amt, acc in FIXED:
                tx(acc, d, desc, -amt)
        if d.day == 17:
            gross = (45500 if d >= date(2026, 4, 1) else 41000) / 12
            ot = random.choice([0, 0, 120, 240, 380, 520])
            gr = round(gross + ot, 2)
            tax_ = round(max(0, gr * 12 - 12570) * 0.2 / 12, 2)
            ni = round(max(0, gr * 12 - 12570) * 0.08 / 12, 2)
            pen = round(gr * 0.05, 2)
            sl = float(int(max(0, gr * 12 - 28470) * 0.09 / 12))
            net = round(gr - tax_ - ni - pen - sl, 2)
            tx(1, d, "TS247 SALARY", net)
            for acc, tag, amt in ((2, "TO JOINT", 620), (3, "TO SAVER", random.choice([300, 400, 500, 600])),
                                  (4, "TO T212", random.choice([100, 150, 200, 250]))):
                a = tx(1, d, tag, -amt)
                b = tx(acc, d, "FROM BARCLAYS", amt)
                if d < date(2026, 9, 1):            # this month's are left to match by hand
                    link(a, b)
            tx(2, d, "TRANSFER FROM A PARTNER", 430)
            pay = d.isoformat()
            worked = (d.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
            db.execute("INSERT INTO payslip (pay_date,worked_month,tax_code,ni_letter) VALUES (?,?,'1257L','A')",
                       (pay, worked))
            for i, (grp, label, qty, amt, code) in enumerate((
                    ("pay", "Basic salary", None, round(gross, 2), "basic"),
                    ("pay", "Overtime ×1.5", round(ot / 19.23, 2) or None, ot, "ot15"),
                    ("deduction", "PAYE tax", None, tax_, "tax"),
                    ("deduction", "National Insurance", None, ni, "ni"),
                    ("deduction", "Pension", None, pen, "pension"),
                    ("deduction", "Student loan", None, sl, "student_loan"),
                    ("employer", "Employer NI", None, round(max(0, gr * 12 - 5000) * 0.15 / 12, 2), "er_ni"),
                    ("employer", "Employer pension", None, round(gr * 0.03, 2), "er_pension"))):
                if amt:
                    db.execute("INSERT INTO payslip_line (pay_date,grp,label,qty,amount,code,sort) VALUES (?,?,?,?,?,?,?)",
                               (pay, grp, label, qty, amt, code, i))
        for desc, lo, hi, acc in VARIABLE:
            if random.random() < 0.075:
                tx(acc, d, desc.replace("{d}", d.strftime("%d%b").upper()).replace("{c}", str(random.randint(1000, 9999))),
                   -round(random.uniform(lo, hi), 2))
        off = db.execute("SELECT 1 FROM leave WHERE ? BETWEEN from_date AND to_date "
                         "UNION SELECT 1 FROM bank_holiday WHERE date=?", (d.isoformat(), d.isoformat())).fetchone()
        if d.weekday() < 5 and not off:
            db.execute("INSERT INTO shift (date,start,end,project) VALUES (?,'07:30',?,?)",
                       (d.isoformat(), random.choice(["15:30","16:00","16:00","16:30","17:00"]) if d.weekday() == 4
                        else random.choice(["16:00","16:00","16:30","17:00","17:30"]),
                        random.choice(["Ultrasonic rig","Motor test rig","Panel build","Site"])))
            if random.random() < 0.09:
                db.execute("INSERT INTO shift (date,start,end,note,project) "
                           "VALUES (?,'19:00','21:30','site callout','Site')", (d.isoformat(),))
        elif d.weekday() == 5 and random.random() < 0.18:
            db.execute("INSERT INTO shift (date,start,end,note,project) "
                       "VALUES (?,'09:00','14:00','weekend commissioning','Site')", (d.isoformat(),))
        d += timedelta(days=1)

    # one unsorted payee, so the review queue has something in it
    tx(1, date(2026, 9, 12), "SQ *THE BEAN STOKE", -38.20)
    tx(1, date(2026, 9, 14), "TRADING212*8842", -250.00)
    # and a loan to a friend, which is not spending
    lent = db.execute("SELECT id FROM tag WHERE name='Dave'").fetchone()["id"]
    tx(1, date(2026, 8, 3), "FASTER PAYMENT D SMITH", -200.00)
    row = db.execute("SELECT id FROM txn WHERE description='FASTER PAYMENT D SMITH'").fetchone()
    db.execute("UPDATE txn SET category_id=?, merchant_locked=1 WHERE id=?", (gid["Lent out"], row["id"]))
    db.execute("INSERT INTO txn_tag (txn_id,tag_id) VALUES (?,?)", (row["id"], lent))

    # valuations, so the investment is worth what it is worth
    for mth, val in (("2026-03-31", 8100), ("2026-06-30", 8720), ("2026-08-31", 9450)):
        db.execute("INSERT INTO valuation (account_id,date,value) VALUES (4,?,?)", (mth, val))

    # reminders: a couple of your own, and one bill already tracked
    db.executescript("""INSERT INTO reminder (title, start, every, amount, note) VALUES
     ('MOT', '2026-10-14', 'year', 54.85, 'Book at the garage a month ahead'),
     ('Car insurance renewal', '2026-11-02', 'year', NULL, 'Get quotes before it auto-renews'),
     ('Barber', '2026-10-03', 'month', 18, NULL);
    INSERT INTO reminder (title, start, every, amount, merchant_id)
     SELECT 'Netflix', '2026-10-01', 'month', 10.99, id FROM merchant WHERE name = 'Netflix';""")

    # newest statement per account becomes the current one, with a closing balance
    db.execute("""UPDATE statement SET role='current' WHERE id IN (
      SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY account_id
        ORDER BY period_end DESC) rn FROM statement) WHERE rn=1)""")
    for s in db.execute("SELECT id, account_id, period_start, period_end FROM statement"):
        prior = db.execute("SELECT COALESCE(SUM(amount),0) v FROM txn t JOIN statement x ON x.id=t.statement_id "
                           "WHERE t.account_id=? AND x.period_end < ?",
                           (s["account_id"], s["period_start"])).fetchone()["v"]
        opening = db.execute("SELECT opening FROM account WHERE id=?", (s["account_id"],)).fetchone()["opening"]
        move = db.execute("SELECT COALESCE(SUM(amount),0) v FROM txn WHERE statement_id=?",
                          (s["id"],)).fetchone()["v"]
        db.execute("UPDATE statement SET opening_balance=?, closing_balance=? WHERE id=?",
                   (round(opening + prior, 2), round(opening + prior + move, 2), s["id"]))
    db.commit()
    matching.rescan(db)
    print(f"money.db: {db.execute('SELECT COUNT(*) FROM txn').fetchone()[0]} transactions, "
          f"{db.execute('SELECT COUNT(*) FROM shift').fetchone()[0]} shifts, "
          f"{db.execute('SELECT COUNT(*) FROM statement').fetchone()[0]} statements, "
          f"{db.execute('SELECT COUNT(*) FROM v_unmatched').fetchone()[0]} unmatched payees")
    db.close()


# ============================================================================== Log
def log():
    from apps.log import app as logapp
    db = _db.open_db(suite.path("log"), APPS["log"], quiet=True, no_backup=True)
    WORK = ["Rig 2 PLC swapped, backed up the old program first. #ts247 #ut-bridge",
            "Waited two hours for the panel delivery.", "Commissioning signed off by the customer. #site",
            "Galil axis tuned: KP 6, KD 64, KI 0.02. Overshoot gone. #ut-bridge",
            "Drive fault F0002 on the Santerno: DC bus overvoltage on decel. Lengthened the ramp. #site #drives",
            "Wrote the SCL for the new interlock. Tested in PLCSIM first. #ts247", "Site visit, surveyed the old panel. #site",
            "Probe calibration on the 25 mm step block. #ut-bridge", "Tidied the WPF HMI trend screen. #scada"]
    DIARY = ["Good day. Gym after work.", "Tired. Early night.", "Ran 5 km before work. Legs heavy.",
             "Read two chapters of the maths book.", "Quiet evening, cooked a curry."]
    d = date(2026, 7, 20)
    while d <= date(2026, 9, 22):
        if d.weekday() < 5 and random.random() < 0.7:
            for _ in range(random.choice([1, 1, 2, 3])):
                logapp.add(db, random.choice(WORK), "work", d.isoformat(),
                           f"{random.randint(7, 17):02d}:{random.choice(['00', '15', '30', '45'])}", log=False)
        if random.random() < 0.5:
            logapp.add(db, random.choice(DIARY), "day", d.isoformat(), log=False)
        d += timedelta(days=1)
    print(f"log.db: {db.execute('SELECT COUNT(*) FROM entry').fetchone()[0]} entries")
    db.close()


# ============================================================================ Learn
def learn():
    """Six weeks of answers (so the heatmap and stats have something), a few cards due now,
    a lesson part-way through, two mistakes, some timed study and a lesson of his own."""
    import json
    from datetime import datetime
    db = _db.open_db(suite.path("learn"), APPS["learn"], quiet=True, no_backup=True)
    cards = [r["id"] for r in db.execute("SELECT id FROM card WHERE source='file' AND type<>'concept' ORDER BY lesson_id, sort")]
    today = date.today()
    for back in range(42, 0, -1):
        d = today - timedelta(days=back)
        if random.random() < 0.3:
            continue
        for cid in random.sample(cards, random.randint(4, 24)):
            ok = random.random() < 0.8
            db.execute("INSERT INTO answer (card_id, lesson_id, subject_id, mode, correct, rating, ms, day, at, level, floor, cold, confidence) "
                       "SELECT id, lesson_id, subject_id, 'feed', ?, ?, ?, ?, ?, level, 0, 1, ? FROM v_card WHERE id = ?",
                       (int(ok), "good" if ok else "again", random.randint(8000, 50000), d.isoformat(), f"{d} 19:30:00",
                        random.choice([None, 1, 2, 2]), cid))
            iv = random.choice([1, 2, 6, 16, 25, 39])
            due = datetime.combine(d + timedelta(days=round(iv)), datetime.min.time()).strftime("%Y-%m-%d %H:%M")
            db.execute("INSERT INTO card_state (card_id, due, interval_days, reps, last_rating, last_seen, stability, difficulty, phase, "
                       "last_review, right_days) VALUES (?, ?, ?, ?, ?, ?, ?, 5, 'review', ?, 1) "
                       "ON CONFLICT(card_id) DO UPDATE SET due=excluded.due, interval_days=excluded.interval_days, "
                       "reps=card_state.reps + 1, last_rating=excluded.last_rating, last_seen=excluded.last_seen, "
                       "stability=excluded.stability, last_review=excluded.last_review, right_days=card_state.right_days + 1",
                       (cid, due, iv, 1, "good" if ok else "again", f"{d} 19:30", iv, f"{d} 19:30"))
        if random.random() < 0.4:
            db.execute("INSERT INTO study (day, subject_id, minutes, note) VALUES (?, ?, ?, ?)",
                       (d.isoformat(), random.choice(["maths", "physics", "plc"]), random.choice([15, 25, 25, 40]), None))
    for cid in ("physics.ut.pulse-echo/echo-between", "drives.control.pid/windup"):
        c = db.execute("SELECT * FROM card WHERE id = ?", (cid,)).fetchone()
        d = json.loads(c["data"])
        db.execute("INSERT OR IGNORE INTO card (id, lesson_id, type, text, data, source) VALUES (?, ?, 'flash', ?, ?, 'mistake')",
                   (f"mistake/{cid}", c["lesson_id"], d["q"][:400],
                    json.dumps({"type": "flash", "front": d["q"], "back": d["options"][d["answer"]] + "\n\n" + d["why"]})))
        db.execute("INSERT INTO card_state (card_id, due) VALUES (?, ?)", (f"mistake/{cid}", f"{today} 07:00"))
    db.execute("INSERT INTO lesson_state (lesson_id, pos, seen) VALUES ('plc.basics.scan-cycle', 6, ?)", (f"{today} 08:10",))
    for cid in cards[3:40:12]:                          # three he keeps missing: Coming back
        db.execute("UPDATE card_state SET struggle = 1, right_days = 1, lapses = 2 WHERE card_id = ?", (cid,))
    from apps.learn import app as learn_app
    for (sid,) in db.execute("SELECT id FROM subject WHERE id <> 'mine'").fetchall():
        learn_app.update_skill(db, sid, None, "demo")
    db.execute("INSERT INTO lesson (id, unit_id, title, sort, source) VALUES ('mine.cards.site', 'mine.cards', 'Site notes', 0, 'own')")
    for i, (f, b) in enumerate([("Santerno F0002?", "DC bus overvoltage, usually on decel: lengthen the ramp or add a braking resistor."),
                                ("Couplant for a hot surface?", "A high-temperature gel rated for it; water boils off.")]):
        db.execute("INSERT INTO card (id, lesson_id, sort, type, text, data, source) VALUES (?, 'mine.cards.site', ?, 'flash', ?, ?, 'own')",
                   (f"own/mine.cards.site/{i}", 1000 + i, f, json.dumps({"type": "flash", "front": f, "back": b})))
    db.commit()
    print(f"learn.db: {db.execute('SELECT COUNT(*) FROM answer').fetchone()[0]} answers, "
          f"{db.execute('SELECT COUNT(*) FROM v_card WHERE due <= ?', (datetime.now().strftime('%Y-%m-%d %H:%M'),)).fetchone()[0]} cards due")
    db.close()


for name, fill in (("money", money), ("log", log), ("learn", learn)):
    if name in APPS and fill:
        fill()
suite.open_all()
print(f"demo data in {os.path.abspath(folder)}; serve it with: python3 daybook.py serve --data {folder}")
