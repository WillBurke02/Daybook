"""Money: hours, pay, holidays, spending, accounts, investments and bills.

Everything generic (tables, views, undo, search, Admin) is core's; this is what
only Money knows: payees and rules, statements, payslips, the tax estimate,
reminders, and the figures formulas can ask for.
"""
import base64
import os
import re
from datetime import date, timedelta

from core import db as _db
from core.api import Err, _select, _maybe_float
from . import importer, matching, reminders, statement, tax, timesheet, t212

HERE = os.path.dirname(os.path.abspath(__file__))
NAME, TITLE, ORDER = "money", "Money", 1
MIGRATIONS = os.path.join(HERE, "migrations")
VIEWS = os.path.join(HERE, "views.sql")
SIGNATURE = "txn"                 # a Money database has transactions
OTHERS = ("log", "learn")         # other apps' files, not offered in Databases

LABELS = {"txn": "transaction", "match_rule": "rule", "merchant": "payee",
          "payslip_line": "payslip line", "leave": "day off", "leave_year": "leave year",
          "bank_holiday": "bank holiday", "pay_rate": "pay rate", "day_rule": "overtime rule",
          "rate_band": "tax band", "txn_tag": "tag"}

# Every word must appear somewhere in the row; a number also finds that amount.
SEARCH = [
    ("txn", "SELECT id, date, description, merchant, category_path, account, amount, note FROM v_txn",
     ["description", "merchant", "category_path", "account", "note", "date"], "amount", "date DESC"),
    ("payee", "SELECT m.id, m.name, c.path AS category, (SELECT COUNT(*) FROM txn t WHERE t.merchant_id = m.id) AS txns "
              "FROM merchant m LEFT JOIN v_category c ON c.id = m.category_id", ["m.name", "c.path"], None, "txns DESC"),
    ("shift", "SELECT id, date, start, end, note, project FROM shift", ["note", "project", "date"], None, "date DESC"),
    ("payslip", "SELECT l.pay_date AS date, l.label, l.amount, l.grp, p.note FROM payslip_line l "
                "JOIN payslip p ON p.pay_date = l.pay_date", ["l.label", "p.note", "l.pay_date"], "l.amount", "l.pay_date DESC"),
    ("leave", "SELECT id, from_date AS date, to_date, days, kind, note FROM leave", ["note", "kind", "from_date"], None, "from_date DESC"),
    ("reminder", "SELECT id, title, start AS date, every, amount, note FROM reminder", ["title", "note"], "amount", "start"),
    ("receipt", "SELECT r.id, r.txn_id, COALESCE(t.date, r.date) AS date, r.note, r.thumb, COALESCE(t.amount, -r.amount) AS amount, "
                "t.description FROM receipt r LEFT JOIN txn t ON t.id = r.txn_id", ["r.note", "t.description", "r.date", "t.date"],
     "COALESCE(t.amount, r.amount)", "date DESC"),
    ("account", "SELECT id, name, kind, provider FROM account", ["name", "provider", "kind"], None, "name"),
    ("category", "SELECT id, path, kind FROM v_category", ["path"], None, "path"),
]

# What to call the data when you make a panel of your own, and what one row is.
# Anything not here is still offered, under its own name, as stored.
SOURCES = {
    "v_day": ["Days worked", "One row a day worked: hours, normal hours, overtime and its rate."],
    "v_day_paid": ["Days worked, with pay", "Each day worked with the hourly rate in force and its overtime pay."],
    "v_shift": ["Shifts", "Every shift as typed: date, start, finish and hours. A split day is two rows."],
    "v_week": ["Weeks worked", "One row a week (from Monday): hours, normal and overtime."],
    "v_month_hours": ["Months: hours", "One row a month: hours and overtime worked."],
    "v_pay_period": ["Pay periods", "Each month worked beside the payslip that paid for it."],
    "v_payslip": ["Payslips", "One row a payslip: gross, tax, NI, pension, student loan, net, overtime pay."],
    "payslip_line": ["Payslip lines", "Every line of every payslip, as typed."],
    "v_tax_year": ["Tax years", "Payslips added up by tax year (6 April to 5 April)."],
    "v_p60": ["P60s", "Each tax year's P60 as typed, beside what its payslips add up to."],
    "v_txn": ["Transactions", "Every bank transaction with its payee, category and account."],
    "v_spend": ["Spending", "Money spent, as a positive amount at your share, with payee and category."],
    "v_money": ["Money in and out", "Every movement split into money in and money out."],
    "v_month_cash": ["Months: money", "One row a month: money in, spent, saved and not yet sorted."],
    "v_month": ["Months", "Each calendar month: money that moved, hours worked, the payslip paid in it."],
    "v_year": ["Years: money", "One row a calendar year: income, spending, saved, left over."],
    "v_budget": ["Budgets", "Each budgeted category, a month at a time: budget against spent."],
    "v_cat_actual": ["Spending by category", "Spent per category per month."],
    "v_merchant_total": ["Payees", "Each payee: how often and how much in all."],
    "v_tag_spend": ["Spending by tag", "Each tagged payment with its tag (a car, a trip, a person)."],
    "v_daily_cum": ["Spending through the month", "The running total of spending, day by day, each month."],
    "v_weekday": ["Spending by weekday", "Each payment with the day of the week it fell on."],
    "v_biggest": ["Biggest payments", "Spending, largest first."],
    "v_account_status": ["Accounts", "Each account with its latest statement balance."],
    "v_valuation": ["Valuations", "The values you recorded for savings, investments and pensions."],
    "v_holding": ["Savings and investments", "Each savings, investment and pension account: its value, paid in and growth."],
    "v_contribution": ["Money put away", "Money into and out of savings, investments and pensions, from every source."],
    "v_invest": ["Investments", "Each investment account: paid in against its latest value."],
    "v_pension_flow": ["Pension payments", "Money into pensions: from payslips and paid in directly."],
    "v_leave_year": ["Leave years", "Each year's annual leave: allowance, taken and left."],
    "leave": ["Days off", "Every day off as typed: from, to, days and type."],
    "bank_holiday": ["Bank holidays", "England and Wales bank holidays."],
    "reminder": ["Reminders", "Bills and anything else that comes round."],
    "v_receipt": ["Receipts", "Each receipt, with the payment it belongs to."],
}

# name: (view, date column, SQL aggregate, what it is). Formulas reach these as
# 2026.May.Hours, 2026.Q2.Spent, 2026.Gross, This.Overtime ...
MEASURES = {
    "Hours":        ("v_day", "date", "SUM(hours)", "Hours worked"),
    "Overtime":     ("v_day", "date", "SUM(ot_hours)", "Overtime hours, both rates"),
    "Overtime15":   ("v_day", "date", "SUM(CASE WHEN ot_mult < 2 THEN ot_hours END)", "Overtime hours at ×1.5"),
    "Overtime2":    ("v_day", "date", "SUM(CASE WHEN ot_mult >= 2 THEN ot_hours END)", "Overtime hours at ×2"),
    "Excess":       ("v_day", "date", "SUM(excess)", "Hours over the daily norm, short days negative"),
    "PaidHours":    ("v_day", "date", "SUM(paid_hours)", "Hours with overtime at its rate"),
    "Days":         ("v_day", "date", "COUNT(*)", "Days worked"),
    "Shifts":       ("v_shift", "date", "COUNT(*)", "Shifts worked"),
    "OvertimePay":  ("v_day_paid", "date", "SUM(ot_pay)", "Overtime pay at your hourly rate"),
    "Spent":        ("v_spend", "date", "SUM(amount)", "Spending, at your share"),
    "Income":       ("v_money", "date", "SUM(CASE WHEN kind = 'income' THEN money_in END)", "Money in marked as income"),
    "MoneyIn":      ("v_money", "date", "SUM(money_in)", "Everything paid into your accounts"),
    "MoneyOut":     ("v_money", "date", "SUM(money_out)", "Everything paid out of your accounts"),
    "Gross":        ("v_payslip", "pay_date", "SUM(gross)", "Gross pay on payslips paid in the period"),
    "Net":          ("v_payslip", "pay_date", "SUM(net)", "Net pay on payslips paid in the period"),
    "Tax":          ("v_payslip", "pay_date", "SUM(tax)", "Income tax on payslips"),
    "NI":           ("v_payslip", "pay_date", "SUM(ni)", "National Insurance on payslips"),
    "Pension":      ("v_payslip", "pay_date", "SUM(pension)", "Your pension contributions on payslips"),
    "EmployerPension": ("v_payslip", "pay_date", "SUM(er_pension)", "Your employer's pension contributions"),
    "StudentLoan":  ("v_payslip", "pay_date", "SUM(student_loan)", "Student loan on payslips"),
    "OvertimePaid": ("v_payslip", "pay_date", "SUM(overtime_pay)", "Overtime pay on payslips"),
    "DaysOff":      ("leave", "from_date", "SUM(CASE WHEN kind = 'holiday' THEN days END)", "Annual leave days taken"),
    "PensionIn":    ("v_pension_flow", "date", "SUM(amount)", "Money into pensions"),
}


# --- around every write -------------------------------------------------------------

def before_write(db, name, row):
    if name == "account" and row.get("sort_code"):
        tidy = format_sort_code(row["sort_code"])
        if not re.fullmatch(r"\d\d-\d\d-\d\d", tidy):
            raise Err(400, "a sort code is six digits, like 20-45-77")
        row["sort_code"] = tidy
        had = row.get("provider") if "provider" in row else (db.execute(
            "SELECT provider FROM account WHERE id = ?", (row.get("id"),)).fetchone() or [None])[0]
        if not had and bank_for_sort_code(tidy):
            row["provider"] = bank_for_sort_code(tidy)          # the bank, from the code; type over it if wrong
    if name == "category":
        _check_category(db, row)
    if name == "match_rule" and row.get("pattern") and row.get("kind") != "regex":
        row["pattern"] = str(row["pattern"]).strip().upper()


def after_write(db, names, op):
    """New or changed rules sort every transaction again; so does undoing a payee."""
    if "match_rule" in names or (op == "undo" and "merchant" in names):
        matching.rescan(db)


def _check_category(db, row):
    cid, parent = row.get("id"), row.get("parent_id")
    if not cid or not parent:
        return
    seen, cur = set(), int(parent)
    while cur and cur not in seen:
        if cur == int(cid):
            raise Err(400, "a category cannot sit inside itself")
        seen.add(cur)
        r = db.execute("SELECT parent_id FROM category WHERE id=?", (cur,)).fetchone()
        cur = r["parent_id"] if r else None


# --- what the suite asks of every app -----------------------------------------------

def meta(db):
    return {"accounts": [dict(r) for r in db.execute(
        "SELECT id, name, kind, colour FROM account ORDER BY sort_order, id")]}


def inspect(count, span):
    """What Admin → Databases shows before opening another Money file."""
    s = lambda sp: f" · {sp[0]} to {sp[1]}" if sp and sp[0] else ""
    return [["Transactions", f"{count('txn')}{s(span('txn', 'date'))}"],
            ["Shifts", f"{count('shift')}{s(span('shift', 'date'))}"],
            ["Payslips", str(count("payslip"))], ["Accounts", str(count("account"))]]


def home(db):
    """The Home card: days to payday, safe to spend, hours this week, bills in the next week."""
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    hours = db.execute("SELECT COALESCE(SUM(hours), 0) FROM v_day WHERE date BETWEEN ? AND ?",
                       (monday.isoformat(), today.isoformat())).fetchone()[0]
    s = safe(db, today)
    week = (today + timedelta(days=7)).isoformat()
    bills = [r for r in reminders.upcoming(db, today) if r["next_due"] and r["next_due"] <= week]
    money = lambda v: f"£{v:,.2f}" if v is not None else "—"
    last = db.execute("SELECT pay_date, net FROM v_payslip ORDER BY pay_date DESC LIMIT 1").fetchone()
    return {"figures": [
                {"label": "Safe to spend", "value": money(s["available"]), "cls": "deb" if (s["available"] or 0) < 0 else "",
                 "sub": f"{money(s['per_day'])} a day" if s["available"] is not None else "type a balance in Money",
                 "href": "#/overview"},
                {"label": "Payday", "value": f"{s['days']} day{'s' if s['days'] != 1 else ''}", "sub": _uk(s["payday"]),
                 "href": "#/pay"},
                {"label": "Hours this week", "value": f"{hours:.2f}h", "href": f"#/hours?p=week:{today.isoformat()}"}]
            + ([{"label": "Last payslip", "value": money(last["net"]), "sub": f"net, paid {_uk(last['pay_date'])}",
                 "href": f"#/pay?slip={last['pay_date']}"}] if last else []),
            "items_title": "Bills in the next 7 days", "items_empty": "None due.",
            "items": [{"when": _uk(r["next_due"])[:5], "text": r["title"], "value": money(r["amount"]) if r["amount"] else "",
                       "href": "#/reminders"} for r in bills],
            "links": [{"label": "Overview", "href": "#/overview"}, {"label": "+ Hours", "href": "#/hours?add=today"}]}


def _uk(d):
    return f"{d[8:10]}/{d[5:7]}/{d[:4]}" if d else ""


# --- sort codes -------------------------------------------------------------------------

# (from, to, bank). The narrowest range that holds a code names its bank. From the
# ranges on Wikipedia's "Sort code" page. ponytail: a guess from the first digits, not
# Pay.UK's directory (which is paid for); the provider box can always be typed over.
BANKS = [
    ("040003", "040008", "Monzo"), ("040040", "040040", "Starling Bank"), ("040075", "040075", "Revolut"),
    ("042909", "042909", "Revolut"), ("040333", "040333", "Mettle (NatWest)"), ("040405", "040405", "ClearBank"),
    ("040605", "040605", "Tide"), ("608371", "608371", "Starling Bank"), ("608407", "608407", "Chase"),
    ("231470", "231470", "Wise"), ("230580", "230580", "Metro Bank"),
    ("010000", "019999", "NatWest"), ("050000", "059999", "Virgin Money (Nationwide)"), ("070000", "074999", "Nationwide"),
    ("080000", "089999", "The Co-operative Bank"), ("090000", "091999", "Santander"), ("110000", "119999", "Halifax (Bank of Scotland)"),
    ("120000", "126999", "Sainsbury's Bank"), ("130000", "139999", "Barclays"), ("150000", "169999", "Royal Bank of Scotland"),
    ("180000", "189999", "Coutts"), ("200000", "299999", "Barclays"), ("300000", "399999", "Lloyds or TSB"),
    ("400000", "499999", "HSBC"), ("500000", "669999", "NatWest"), ("720000", "729999", "Santander"),
    ("770000", "774499", "Lloyds or TSB"), ("800000", "819999", "Bank of Scotland"), ("820000", "829999", "Virgin Money (Nationwide)"),
    ("830000", "839999", "Royal Bank of Scotland"), ("870000", "879999", "TSB"), ("890000", "892999", "Santander"),
    ("900000", "909999", "Bank of Ireland"), ("910000", "919999", "Danske Bank"), ("930000", "939999", "AIB"),
    ("940000", "949999", "Bank of Ireland"), ("950000", "959999", "Danske Bank"), ("980000", "989999", "Ulster Bank"),
]


def format_sort_code(v):
    """Six digits however typed (200000, 20 00 00) as 20-00-00; anything else as it was."""
    d = re.sub(r"\D", "", str(v or ""))
    return f"{d[:2]}-{d[2:4]}-{d[4:]}" if len(d) == 6 else (str(v).strip() if v else v)


def bank_for_sort_code(v):
    d = re.sub(r"\D", "", str(v or ""))
    if len(d) != 6:
        return None
    hits = [(int(hi) - int(lo), bank) for lo, hi, bank in BANKS if lo <= d <= hi]
    return min(hits)[1] if hits else None


# --- bank holidays (England and Wales) ---------------------------------------------

def _easter(y):
    """Easter Sunday: the anonymous Gregorian computus."""
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    g = (8 * b + 13) // 25
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    month = (h + l_ - 7 * m + 114) // 31
    return date(y, month, (h + l_ - 7 * m + 114) % 31 + 1)


# Days that moved or were added by proclamation. ponytail: to 2023; a new one is
# typed in under Annual leave → Bank holidays, as it always could be.
ONE_OFFS = {
    2002: ({"Spring bank holiday": date(2002, 6, 4)}, [(date(2002, 6, 3), "Golden Jubilee")]),
    2011: ({}, [(date(2011, 4, 29), "Royal wedding")]),
    2012: ({"Spring bank holiday": date(2012, 6, 4)}, [(date(2012, 6, 5), "Diamond Jubilee")]),
    2020: ({"Early May bank holiday (VE Day)": date(2020, 5, 8)}, []),
    2022: ({"Spring bank holiday": date(2022, 6, 2)}, [(date(2022, 6, 3), "Platinum Jubilee"),
                                                      (date(2022, 9, 19), "State Funeral of Queen Elizabeth II")]),
    2023: ({}, [(date(2023, 5, 8), "Coronation of King Charles III")]),
}


def bank_holidays(y):
    """England and Wales bank holidays for a year, weekends moved to the next weekday."""
    mon = lambda d: d + timedelta(days=(7 - d.weekday()) % 7)                 # that day, or the Monday after
    last_mon = lambda m: max(date(y, m, d) for d in range(22, 32 if m in (5, 8) else 31) if date(y, m, d).weekday() == 0)
    e = _easter(y)
    new_year = date(y, 1, 1)
    weekday = new_year if new_year.weekday() < 5 else mon(new_year)
    out = [(weekday, "New Year's Day" + (" (substitute)" if new_year.weekday() > 4 else "")),
           (e - timedelta(days=2), "Good Friday"), (e + timedelta(days=1), "Easter Monday"),
           (mon(date(y, 5, 1)), "Early May bank holiday"), (last_mon(5), "Spring bank holiday"),
           (last_mon(8), "Summer bank holiday")]
    xmas, boxing = date(y, 12, 25), date(y, 12, 26)
    if xmas.weekday() == 5:          # Saturday: both move to Monday and Tuesday
        out += [(date(y, 12, 27), "Christmas Day (substitute)"), (date(y, 12, 28), "Boxing Day (substitute)")]
    elif xmas.weekday() == 6:        # Sunday: Boxing Day on Monday, Christmas on Tuesday
        out += [(boxing, "Boxing Day"), (date(y, 12, 27), "Christmas Day (substitute)")]
    elif xmas.weekday() == 4:        # Friday: Boxing Day falls on Saturday, so Monday
        out += [(xmas, "Christmas Day"), (date(y, 12, 28), "Boxing Day (substitute)")]
    else:
        out += [(xmas, "Christmas Day"), (boxing, "Boxing Day")]
    moved, added = ONE_OFFS.get(y, ({}, []))
    for name, d in moved.items():
        base = name.split(" (")[0]
        out = [(d, name) if n == base else (x, n) for x, n in out]
    return sorted(out + added)


def fill_bank_holidays(db, years):
    """A year with no bank holidays gets them worked out; one you have typed is left alone."""
    added = 0
    for y in years:
        if not db.execute("SELECT 1 FROM bank_holiday WHERE date LIKE ?", (f"{y}-%",)).fetchone():
            db.executemany("INSERT OR IGNORE INTO bank_holiday (date, name) VALUES (?, ?)",
                           [(d.isoformat(), n) for d, n in bank_holidays(y)])
            added += 1
    db.commit()
    return added


def after_migrate(db):
    """Every start: bank holidays from 2000 to five years ahead, and sort codes tidied."""
    fill_bank_holidays(db, range(2000, date.today().year + 6))
    for r in db.execute("SELECT id, sort_code, provider FROM account WHERE sort_code IS NOT NULL").fetchall():
        tidy = format_sort_code(r["sort_code"])
        bank = r["provider"] or bank_for_sort_code(tidy)
        if tidy != r["sort_code"] or bank != r["provider"]:
            db.execute("UPDATE account SET sort_code = ?, provider = ? WHERE id = ?", (tidy, bank, r["id"]))
    db.commit()


def next_payday(db, today):
    """The next payday after today. ponytail: the day of the month only; a payday
    on a weekend is not moved to the Friday before."""
    day = min(int(_db.settings(db).get("payday", 17) or 17), 28)
    d = date(today.year, today.month, day)
    if d <= today:
        d = date(today.year + (today.month == 12), today.month % 12 + 1, day)
    return d


def safe(db, today=None):
    """Safe to spend until payday: the balance you have, less the bills due before
    payday and what you mean to save. Only what you typed: the balance is the
    chosen current account's latest statement closing balance, or the balance you
    typed if that is newer; the bills are reminders with amounts."""
    today = today or date.today()
    st = _db.settings(db)
    payday = next_payday(db, today)
    acct = db.execute("SELECT * FROM v_account_status WHERE archived = 0 AND kind = 'current' "
                      "AND (id = ? OR ? = '') ORDER BY sort_order, id LIMIT 1",
                      (st.get("safe_account") or "", st.get("safe_account") or "")).fetchone()
    balance, on, source = (acct["balance"], acct["as_of"], "statement") if acct and acct["balance"] is not None else (None, None, None)
    typed, typed_on = _maybe_float(st.get("safe_balance")), st.get("safe_balance_on") or ""
    if typed is not None and typed_on and (not on or typed_on >= on):
        balance, on, source = typed, typed_on, "typed"
    bills = []
    for r in reminders.upcoming(db, today):
        if not r["amount"] or not r["next_due"]:
            continue
        for k in range(400):
            d = reminders.nth(r["start"], r["every"], k) if r["every"] != "once" else date.fromisoformat(r["start"])
            if d >= payday:
                break
            if d.isoformat() >= r["next_due"] and (not on or d.isoformat() > on):
                bills.append({"title": r["title"], "date": d.isoformat(), "amount": round(r["amount"], 2)})
            if r["every"] == "once":
                break
    bills.sort(key=lambda b: b["date"])
    savings = _maybe_float(st.get("safe_savings")) or 0
    total = round(sum(b["amount"] for b in bills), 2)
    available = None if balance is None else round(balance - total - savings, 2)
    days = (payday - today).days
    return {"payday": payday.isoformat(), "days": days, "account": acct["name"] if acct else None,
            "balance": balance, "balance_on": on, "balance_from": source, "bills": bills, "bills_total": total,
            "savings": savings, "available": available,
            "per_day": None if available is None else round(available / max(days, 1), 2)}


def calendar(db, frm, to):
    """Events for the calendar feed: bills with amounts, paydays, days off, bank holidays."""
    out = []
    for r in reminders.upcoming(db):
        for k in range(2000):                     # ponytail: walks each series from its start
            d = (reminders.nth(r["start"], r["every"], k) if r["every"] != "once" else date.fromisoformat(r["start"])).isoformat()
            if d > to:
                break
            if d >= frm and (not r["next_due"] or d >= r["next_due"]):
                amount = f" £{r['amount']:,.2f}" if r["amount"] else ""
                out.append({"uid": f"reminder-{r['id']}-{d}", "date": d, "title": f"{r['title']}{amount}", "note": r["note"]})
            if r["every"] == "once":
                break
    day = int(_db.settings(db).get("payday", 17) or 17)
    y, m = int(frm[:4]), int(frm[5:7])
    while f"{y}-{m:02d}" <= to[:7]:
        d = f"{y}-{m:02d}-{min(day, 28):02d}"
        if frm <= d <= to:
            out.append({"uid": f"payday-{d}", "date": d, "title": "Payday"})
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    for r in db.execute("SELECT id, from_date, to_date, kind, note FROM leave WHERE to_date >= ? AND from_date <= ?", (frm, to)):
        out.append({"uid": f"leave-{r['id']}", "date": r["from_date"], "end": r["to_date"],
                    "title": r["note"] or {"holiday": "Annual leave", "extra": "Time off in lieu"}.get(r["kind"], "Day off")})
    for r in db.execute("SELECT date, name FROM bank_holiday WHERE date BETWEEN ? AND ?", (frm, to)):
        out.append({"uid": f"bank-{r['date']}", "date": r["date"], "title": r["name"]})
    return out


def check(db):
    """Everything `daybook.py check` reports."""
    q = lambda sql: [dict(r) for r in db.execute(sql)]
    return {
        "accounts": q("SELECT * FROM v_account_status WHERE archived=0"),
        "unreconciled": q("SELECT * FROM v_statement_check WHERE status='off'"),
        "gaps": q("SELECT g.*, a.name AS account FROM v_coverage_gap g "
                  "JOIN account a ON a.id=g.account_id WHERE g.days > 0"),
        "overlaps": q("SELECT g.*, a.name AS account FROM v_coverage_gap g "
                      "JOIN account a ON a.id=g.account_id WHERE g.days < 0"),
        "unmatched": db.execute("SELECT COUNT(*) n FROM v_unmatched").fetchone()["n"],
        "uncategorised_txns": db.execute(
            "SELECT COUNT(*) n FROM v_txn WHERE category_kind='unmatched'").fetchone()["n"],
    }


# --- Money's own endpoints ----------------------------------------------------------

def route(db, method, p, query, body, ctx):
    g = lambda k, d=None: (query.get(k) or [d])[0]

    if p[:1] == ["bank_holidays"] and len(p) == 2 and method == "POST":
        if not re.fullmatch(r"(19|20|21)\d\d", p[1]):
            raise Err(400, "a year, like 2019")
        return 200, {"added": fill_bank_holidays(db, [int(p[1])])}

    # a statement PDF: what it says, for the page to show before anything is saved
    if p == ["valuations", "read"] and method == "POST":
        m = re.fullmatch(r"data:application/pdf;base64,([A-Za-z0-9+/=\s]+)", body.get("data") or "")
        if not m:
            raise Err(400, "send the PDF as a data URL")
        accts = [dict(r) for r in db.execute("SELECT id, name, provider, kind FROM account WHERE archived = 0 "
                                             "AND kind IN ('savings', 'investment', 'pension')")]
        try:
            return 200, statement.read(base64.b64decode(m.group(1)), accts)
        except ValueError as e:
            raise Err(422, f"Could not read it: {e}")

    # Trading 212's history CSV: payments in and out, to look at first (plan) and then record
    if p[:1] == ["t212"] and len(p) == 2 and p[1] in ("plan", "commit") and method == "POST":
        acct = db.execute("SELECT id FROM account WHERE id = ? AND kind IN ('savings', 'investment', 'pension')",
                          (body.get("account_id"),)).fetchone()
        if not acct:
            raise Err(400, "choose the savings, investment or pension account it is for")
        try:
            return 200, (t212.plan if p[1] == "plan" else t212.commit)(db, acct[0], body.get("text") or "")
        except ValueError as e:
            raise Err(422, str(e))

    if p[:1] == ["category"] and len(p) == 2 and method == "DELETE":
        return 200, delete_category(db, int(p[1]), g("move_to") or None)

    if p == ["categories", "move"] and method == "POST":
        src, dst = body.get("from_id"), body.get("to_id")
        if not src:
            raise Err(400, "from_id is required")
        before = [{"op": "restore", "table": t, "rows": _select(db, t, {"category_id": src})}
                  for t in ("merchant", "txn")]
        n = db.execute("UPDATE merchant SET category_id=? WHERE category_id=?", (dst, src)).rowcount
        n += db.execute("UPDATE txn SET category_id=? WHERE category_id=?", (dst, src)).rowcount
        _db.log_change(db, "remap", "category", f"Moved everything from #{src} to #{dst}",
                       detail={"undo": before}, rows=n)
        db.commit()
        return 200, {"ok": True, "moved": n}

    # --- payees and rules
    if p == ["review"] and method == "GET":
        return 200, [dict(r) for r in db.execute("SELECT * FROM v_unmatched LIMIT ?",
                                                 (int(g("limit", 100)),))]
    if p == ["review", "accept"] and method == "POST":
        return 200, accept(db, body)
    if p == ["rescan"] and method == "POST":
        n = matching.rescan(db, only_unlocked=not body.get("force"))
        _db.log_change(db, "rescan", "txn", f"Re-applied rules to {n} transactions", rows=n)
        db.commit()
        return 200, {"ok": True, "changed": n}
    if p == ["rules", "test"] and method == "GET":
        return 200, matching.explain(db, g("q", ""))
    if p == ["rules", "preview"] and method == "GET":
        return 200, matching.preview(db, g("kind", "contains"), g("pattern", ""))

    # --- tags
    if p[:1] == ["tags"] and len(p) == 3 and method in ("POST", "DELETE"):
        txn_id, tag_id = int(p[1]), int(p[2])
        if method == "POST":
            db.execute("INSERT OR IGNORE INTO txn_tag (txn_id, tag_id) VALUES (?,?)", (txn_id, tag_id))
            undo_ = [{"op": "remove_where", "table": "txn_tag", "where": {"txn_id": txn_id, "tag_id": tag_id}}]
        else:
            db.execute("DELETE FROM txn_tag WHERE txn_id=? AND tag_id=?", (txn_id, tag_id))
            undo_ = [{"op": "restore", "table": "txn_tag", "rows": [{"txn_id": txn_id, "tag_id": tag_id}]}]
        _db.log_change(db, "edit", "txn_tag",
                       f"{'Tagged' if method == 'POST' else 'Untagged'} transaction #{txn_id}",
                       detail={"undo": undo_})
        db.commit()
        return 200, {"ok": True}
    if p == ["tags", "of"] and method == "GET":
        ids = [int(x) for x in (g("txn_ids", "") or "").split(",") if x.strip()]
        out = {}
        if ids:
            qs = ",".join("?" for _ in ids)
            for r in db.execute(f"SELECT x.txn_id, g.id, g.name FROM txn_tag x "
                                f"JOIN tag g ON g.id = x.tag_id WHERE x.txn_id IN ({qs})", ids):
                out.setdefault(str(r["txn_id"]), []).append({"id": r["id"], "name": r["name"]})
        return 200, out

    # --- links between your own accounts
    if p == ["link"] and method == "POST":
        return 200, link(db, int(body["a"]), int(body["b"]))
    if p[:1] == ["link"] and len(p) == 2 and method == "DELETE":
        return 200, link(db, int(p[1]), None)

    # --- statements
    if p[:1] == ["statement"] and len(p) == 3 and p[2] == "current" and method == "POST":
        sid = int(p[1])
        row = db.execute("SELECT account_id FROM statement WHERE id=?", (sid,)).fetchone()
        if not row:
            raise Err(404, "no such statement")
        before = _select(db, "statement", {"account_id": row["account_id"]})
        db.execute("UPDATE statement SET role='history' WHERE account_id=? AND role='current'",
                   (row["account_id"],))
        db.execute("UPDATE statement SET role='current' WHERE id=?", (sid,))
        # put every role back: all to history first, so the one-current rule holds
        _db.log_change(db, "edit", "statement", f"Statement #{sid} is now current", sid, detail={
            "undo": [{"op": "restore", "table": "statement",
                      "rows": [dict(r, role="history") for r in before]},
                     {"op": "restore", "table": "statement",
                      "rows": [r for r in before if r["role"] == "current"]}]})
        db.commit()
        return 200, {"ok": True}
    if p[:1] == ["statement"] and len(p) == 2 and method == "DELETE":
        from core.api import _dependents
        sid = int(p[1])
        st = _select(db, "statement", {"id": sid})
        txns = _select(db, "txn", {"statement_id": sid})
        undo_ = ([{"op": "restore", "table": "statement", "rows": st},
                  {"op": "restore", "table": "txn", "rows": txns}]
                 + [d for d in _dependents(db, "txn", txns) if d["table"] != "statement"])
        n = db.execute("DELETE FROM txn WHERE statement_id=?", (sid,)).rowcount
        db.execute("DELETE FROM statement WHERE id=?", (sid,))
        _db.log_change(db, "delete", "statement",
                       f"Removed statement #{sid} and its {n} transactions", sid,
                       detail={"undo": undo_}, rows=n)
        db.commit()
        return 200, {"ok": True, "deleted": n}

    if p[:1] == ["import"] and len(p) == 2 and method == "POST":
        return 200, do_import(db, p[1], body)

    # --- hours
    if p == ["hours", "plan"] and method == "POST":
        f = (body.get("files") or [{}])[0]
        return 200, timesheet.plan_hours(f.get("text", ""), f.get("name", "hours.csv"))
    if p == ["hours", "commit"] and method == "POST":
        f = (body.get("files") or [{}])[0]
        plan = timesheet.plan_hours(f.get("text", ""), f.get("name", "hours.csv"))
        return 200, timesheet.commit_hours(db, plan, bool(body.get("replace")))
    if p[:2] == ["hours", "hr"] and len(p) == 3:
        month = p[2]
        return 200, {"month": month, "table": timesheet.hr_table(db, month),
                     "tsv": timesheet.hr_tsv(db, month), "csv": timesheet.hr_csv(db, month)}

    # --- payslips and pay
    if p == ["payslip", "template"] and method == "GET":
        return 200, payslip_template(db)
    if p[:1] == ["payslip"] and len(p) == 2 and method == "GET":
        return 200, payslip_get(db, p[1])
    if p == ["payslip"] and method == "POST":
        return 200, payslip_save(db, body)
    if p[:2] == ["estimate", "month"] and len(p) == 3:
        return 200, tax.month_estimate(db, p[2])
    if p[:2] == ["estimate", "year"] and len(p) == 3:
        return 200, tax.year_estimate(db, int(p[2]))
    if p == ["estimate"]:
        over = {k: g(k) for k in ("pension_pct", "pension_relief", "student_loan_plan",
                                  "employer_pension_pct") if g(k)}
        return 200, tax.breakdown(db, float(g("gross", 0)),
                                  int(g("tax_year", tax.tax_year_of("2026-09-20"))),
                                  int(g("periods", 1)), **over)
    if p == ["check"] and method == "GET":
        return 200, check(db)

    # --- safe to spend, receipts
    if p == ["safe"] and method == "GET":
        return 200, safe(db)
    if p == ["receipts", "of"] and method == "GET":
        ids = [int(x) for x in (g("txn_ids", "") or "").split(",") if x.strip()]
        out = {}
        if ids:
            for r in db.execute(f"SELECT id, txn_id, thumb, note, image LIKE 'data:application/pdf%' AS pdf FROM receipt "
                                f"WHERE txn_id IN ({','.join('?' * len(ids))}) ORDER BY id", ids):
                out.setdefault(str(r["txn_id"]), []).append(dict(r))
        return 200, out
    if p[:1] == ["receipts"] and len(p) == 3 and p[2] == "matches" and method == "GET":
        return 200, receipt_matches(db, int(p[1]))

    # --- reminders, the tax year
    if p == ["reminders"] and method == "GET":
        return 200, reminders.upcoming(db)
    if p == ["reminders", "suggest"] and method == "GET":
        return 200, reminders.suggest(db)
    if p[:1] == ["taxyear"] and len(p) == 2 and method == "GET":
        return 200, tax.year_check(db, int(p[1]))
    return None


def receipt_matches(db, rid):
    """Payments a receipt kept for later might belong to: the same amount, within a
    week of its date. Suggestions only: nothing is linked until you press Link."""
    r = db.execute("SELECT * FROM receipt WHERE id = ?", (rid,)).fetchone()
    if not r:
        raise Err(404, "no such receipt")
    where, args = ["t.id NOT IN (SELECT txn_id FROM receipt WHERE txn_id IS NOT NULL)"], []
    if r["amount"] is not None:
        where.append("ABS(ABS(t.amount) - ?) < 0.005")
        args.append(abs(r["amount"]))
    if r["date"]:
        where.append("t.date BETWEEN date(?, '-7 days') AND date(?, '+7 days')")
        args += [r["date"], r["date"]]
    if len(where) == 1:
        return []
    return [dict(x) for x in db.execute(
        "SELECT t.id, t.date, t.description, t.amount, t.merchant, t.account FROM v_txn t WHERE "
        + " AND ".join(where) + " ORDER BY ABS(julianday(t.date) - julianday(COALESCE(?, t.date))) LIMIT 20",
        args + [r["date"]])]


# --- payees ------------------------------------------------------------------

def ensure_category(db, path, kind="spend", created=None):
    """'Groceries · Lidl' -> the id of Lidl under Groceries, creating either."""
    parent = None
    for name in [x.strip() for x in re.split(r"\s*[·>/]\s*", path) if x.strip()]:
        row = db.execute("SELECT id, kind FROM category WHERE name = ? AND parent_id IS ?",
                         (name, parent)).fetchone()
        if row:
            parent, kind = row["id"], row["kind"]
            continue
        parent = db.execute("INSERT INTO category (parent_id, name, kind) VALUES (?,?,?)",
                            (parent, name, kind)).lastrowid
        if created is not None:
            created.append(parent)
    return parent


def accept(db, body):
    """Sort a payee: name it, give it a category, and write the rule that sorts
    it next time. Everything it created can be undone together."""
    norm = (body.get("description_norm") or "").strip()
    made_cats, undo_ = [], []
    cat = body.get("category_id")
    if not cat and body.get("category"):
        cat = ensure_category(db, body["category"], body.get("kind") or "spend", made_cats)
    mid = body.get("merchant_id")
    if not mid:
        name = (body.get("payee") or norm.title()).strip()
        if not name:
            raise Err(400, "a payee needs a name")
        row = db.execute("SELECT * FROM merchant WHERE name = ?", (name,)).fetchone()
        if row:
            mid = row["id"]
            undo_.append({"op": "restore", "table": "merchant", "rows": [dict(row)]})
            if cat:
                db.execute("UPDATE merchant SET category_id=? WHERE id=?", (cat, mid))
        else:
            mid = matching.ensure_merchant(db, name, cat)
            undo_.append({"op": "remove", "table": "merchant", "pk": "id", "ids": [mid]})
    elif cat:
        undo_.append({"op": "restore", "table": "merchant",
                      "rows": _select(db, "merchant", {"id": mid})})
        db.execute("UPDATE merchant SET category_id=? WHERE id=?", (cat, mid))
    kind = body.get("rule_kind") or "contains"
    pattern = (body.get("pattern") or norm).strip()
    pattern = pattern if kind == "regex" else pattern.upper()
    if not pattern:
        raise Err(400, "a rule needs a pattern")
    old = db.execute("SELECT * FROM match_rule WHERE kind=? AND pattern=?", (kind, pattern)).fetchone()
    if old:
        undo_.append({"op": "restore", "table": "match_rule", "rows": [dict(old)]})
        db.execute("UPDATE match_rule SET merchant_id=? WHERE id=?", (mid, old["id"]))
    else:
        rid = db.execute("INSERT INTO match_rule (merchant_id, kind, pattern, priority) "
                         "VALUES (?,?,?,?)",
                         (mid, kind, pattern, 10 if kind == "exact" else 100)).lastrowid
        undo_.insert(0, {"op": "remove", "table": "match_rule", "pk": "id", "ids": [rid]})
    if made_cats:
        undo_.append({"op": "remove", "table": "category", "pk": "id", "ids": made_cats[::-1]})
    _db.log_change(db, "remap", "match_rule", f"{kind} '{pattern}' → payee #{mid}",
                   detail={"undo": undo_})
    db.commit()
    return {"ok": True, "merchant_id": mid, "category_id": cat, "changed": matching.rescan(db)}


def delete_category(db, cid, move_to=None):
    """Children move up a level rather than vanishing with their parent; its
    payees and transactions go to move_to, or back to Unsorted."""
    cat = _select(db, "category", {"id": cid})
    if not cat:
        raise Err(404, "no such category")
    undo_ = [{"op": "restore", "table": "category", "rows": cat},
             {"op": "restore", "table": "category", "rows": _select(db, "category", {"parent_id": cid})},
             {"op": "restore", "table": "merchant", "rows": _select(db, "merchant", {"category_id": cid})},
             {"op": "restore", "table": "txn", "rows": _select(db, "txn", {"category_id": cid})}]
    db.execute("UPDATE category SET parent_id=? WHERE parent_id=?", (cat[0]["parent_id"], cid))
    n = db.execute("UPDATE merchant SET category_id=? WHERE category_id=?", (move_to, cid)).rowcount
    n += db.execute("UPDATE txn SET category_id=? WHERE category_id=?", (move_to, cid)).rowcount
    db.execute("DELETE FROM category WHERE id=?", (cid,))
    _db.log_change(db, "delete", "category", f"Deleted category {cat[0]['name']}", cid,
                   detail={"undo": undo_}, rows=n)
    db.commit()
    return {"ok": True, "moved": n}


def link(db, a, b):
    """Pair two transactions as one movement between your accounts. b=None unlinks a."""
    ids = {a} | ({b} if b else set())
    partners = {r["link_id"] for r in db.execute(
        f"SELECT link_id FROM txn WHERE id IN ({','.join('?' * len(ids))}) AND link_id IS NOT NULL",
        list(ids))}
    touched = sorted(ids | partners)
    before = [dict(r) for r in db.execute(
        f"SELECT * FROM txn WHERE id IN ({','.join('?' * len(touched))})", touched)]
    if b and len(before) < 2:
        raise Err(404, "no such transaction")
    q = ",".join("?" * len(touched))
    db.execute(f"UPDATE txn SET link_id = NULL WHERE id IN ({q}) OR link_id IN ({q})",
               touched + touched)
    if b:
        db.execute("UPDATE txn SET link_id = ? WHERE id = ?", (b, a))
        db.execute("UPDATE txn SET link_id = ? WHERE id = ?", (a, b))
    _db.log_change(db, "edit", "txn", f"Linked #{a} and #{b}" if b else f"Unlinked #{a}",
                   detail={"undo": [{"op": "restore", "table": "txn", "rows": before}]})
    db.commit()
    return {"ok": True}


# --- statements in -----------------------------------------------------------

def _plan(db, f, body):
    return importer.plan_one(
        db, f["text"], f["name"], account_id=f.get("account_id") or body.get("account_id"),
        mapping=body.get("mapping"), flip=bool(body.get("flip")),
        opening=_maybe_float(body.get("opening")), closing=_maybe_float(body.get("closing")),
        period_start=body.get("period_start") or None, period_end=body.get("period_end") or None,
        date_style=body.get("date_style") or None)


def do_import(db, step, body):
    f = body.get("files") or []
    if not f:
        raise Err(400, "no files")
    bulk = len(f) > 1 or body.get("bulk")
    if step == "plan":
        if not bulk:
            plan = _plan(db, f[0], body)
            plan.pop("rows", None)
            return {"mode": "one", "plan": plan}
        return {"mode": "bulk", "plan": _strip_rows(importer.plan_bulk(
            db, [(x["name"], x["text"], x.get("account_id") or body.get("account_id")) for x in f]))}
    if step != "commit":
        raise Err(404, "no such endpoint")
    if not bulk:
        plan = _plan(db, f[0], body)
        sid = importer.commit(db, plan, make_current=bool(body.get("make_current", True)),
                              save_profile_as=body.get("save_profile_as") or plan["filename"])
        return {"ok": True, "statement_id": sid, "rows": plan["count"]}
    plan = importer.plan_bulk(
        db, [(x["name"], x["text"], x.get("account_id") or body.get("account_id")) for x in f])
    n = importer.commit_bulk(db, plan, newest_current=bool(body.get("make_current", True)))
    return {"ok": True, "files": n, "rows": plan["total_rows"]}


def _strip_rows(bulk):
    for grp in bulk["groups"]:
        for pl in grp["plans"]:
            pl.pop("rows", None)
    return bulk


# --- payslips ----------------------------------------------------------------

TEMPLATE = [("pay", "Basic pay", "basic"), ("pay", "Overtime ×1.5", "ot15"), ("pay", "Overtime ×2", "ot2"),
            ("deduction", "Tax", "tax"), ("deduction", "National Insurance", "ni"),
            ("deduction", "Pension", "pension"), ("deduction", "Student loan", "student_loan"),
            ("employer", "Employer NI", "er_ni"), ("employer", "Employer pension", "er_pension")]
LINE_KEYS = ("grp", "label", "qty", "rate", "amount", "code")


def payslip_get(db, pay_date):
    head = db.execute("SELECT * FROM payslip WHERE pay_date = ?", (pay_date,)).fetchone()
    if not head:
        raise Err(404, "no payslip on that date")
    return {"payslip": dict(head),
            "lines": [dict(r) for r in db.execute(
                "SELECT * FROM payslip_line WHERE pay_date = ? ORDER BY grp, sort, id", (pay_date,))],
            "totals": dict(db.execute("SELECT * FROM v_payslip WHERE pay_date = ?",
                                      (pay_date,)).fetchone())}


def pay_rates(db, on):
    """The salary in force on a date and the hourly rate it makes: the hourly rate
    you typed, else salary / (52 x contract hours a week), as v_day_paid has it."""
    r = (db.execute("SELECT annual, ot_hourly FROM pay_rate WHERE from_date <= ? ORDER BY from_date DESC LIMIT 1", (on,)).fetchone()
         or db.execute("SELECT annual, ot_hourly FROM pay_rate ORDER BY from_date LIMIT 1").fetchone())
    if not r:
        return None, None
    week = _maybe_float(_db.settings(db).get("weekly_contract_hours"))
    return r["annual"], r["ot_hourly"] or (r["annual"] / (52 * week) if week else None)


def _prev_month(d):
    y, m = int(d[:4]), int(d[5:7])
    return f"{y - (m == 1)}-{12 if m == 1 else m - 1:02d}"


def payslip_template(db):
    """A new payslip: the last one's lines, empty, dated the payday after it (hours
    worked the month before). Basic pay and the overtime rates come as hints from
    the salary in force: left empty, a hint is what is saved. Units are yours."""
    last = db.execute("SELECT * FROM payslip ORDER BY pay_date DESC LIMIT 1").fetchone()
    day = min(int(_db.settings(db).get("payday", 17) or 17), 28)
    if last:
        y, m = int(last["pay_date"][:4]), int(last["pay_date"][5:7])
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
        lines = [{k: r[k] for k in ("grp", "label", "code")} for r in db.execute(
            "SELECT * FROM payslip_line WHERE pay_date = ? ORDER BY grp, sort, id", (last["pay_date"],))]
        had_rate = {r["code"] for r in db.execute(
            "SELECT code FROM payslip_line WHERE pay_date = ? AND rate IS NOT NULL", (last["pay_date"],))}
        head = {"tax_code": last["tax_code"], "ni_letter": last["ni_letter"]}
    else:
        t = date.today()
        y, m = t.year, t.month
        lines = [{"grp": g_, "label": l_, "code": c_} for g_, l_, c_ in TEMPLATE]
        had_rate = set()
        st = _db.settings(db)
        head = {"tax_code": st.get("tax_code") or None, "ni_letter": st.get("ni_table") or None}
    pay_date = f"{y}-{m:02d}-{day:02d}"
    at = next((i + 1 for i, ln in enumerate(lines) if ln.get("code") == "basic"), 0)
    for g_, l_, c_ in TEMPLATE[1:3][::-1]:          # both overtime lines, always, under Basic
        if not any(ln.get("code") == c_ for ln in lines):
            lines.insert(at, {"grp": g_, "label": l_, "code": c_})
    annual, hourly = pay_rates(db, pay_date)
    for ln in lines:
        ln.update(qty=None, rate=None, amount=None)
        c = ln.get("code")
        if c == "basic" and annual:
            ln["hint"] = {"amount": round(annual / 12, 2)}
            if "basic" in had_rate and hourly:
                ln["hint"]["rate"] = round(hourly, 2)
        elif c in ("ot15", "ot2") and hourly:
            ln["hint"] = {"rate": round(hourly * (1.5 if c == "ot15" else 2), 2)}
    return {"payslip": dict(head, pay_date=pay_date, worked_month=_prev_month(pay_date), note=None),
            "lines": lines, "new": True, "hourly": hourly and round(hourly, 4), "annual": annual}


def payslip_save(db, body):
    from core.api import _put
    pay_date = (body.get("pay_date") or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", pay_date):
        raise Err(400, "pay date must be YYYY-MM-DD")
    was = body.get("was") or pay_date
    if body.get("new") and db.execute("SELECT 1 FROM payslip WHERE pay_date=?", (pay_date,)).fetchone():
        raise Err(409, f"there is already a payslip paid on {_uk(pay_date)}: open it from the list to change it")
    old_head = _select(db, "payslip", {"pay_date": was})
    old_lines = _select(db, "payslip_line", {"pay_date": was})
    if was != pay_date and db.execute("SELECT 1 FROM payslip WHERE pay_date=?", (pay_date,)).fetchone():
        raise Err(409, f"there is already a payslip paid on {_uk(pay_date)}")
    if old_head and was != pay_date:
        db.execute("UPDATE payslip SET pay_date = ? WHERE pay_date = ?", (pay_date, was))
    head = {k: (body.get(k) or None) for k in ("worked_month", "tax_code", "ni_letter", "note")}
    _put(db, "payslip", dict(head, pay_date=pay_date))
    db.execute("DELETE FROM payslip_line WHERE pay_date = ?", (pay_date,))
    for i, ln in enumerate(body.get("lines") or []):
        if ln.get("grp") not in ("pay", "deduction", "employer", "ytd"):
            raise Err(400, f"unknown group: {ln.get('grp')}")
        if not str(ln.get("label") or "").strip() and not ln.get("amount"):
            continue
        db.execute("INSERT INTO payslip_line (pay_date, grp, label, qty, rate, amount, code, sort) "
                   "VALUES (?,?,?,?,?,?,?,?)",
                   (pay_date, ln["grp"], str(ln.get("label") or "").strip() or "Line",
                    _maybe_float(ln.get("qty")), _maybe_float(ln.get("rate")),
                    _maybe_float(ln.get("amount")) or 0, ln.get("code") or None, i))
    undo_ = [{"op": "remove", "table": "payslip", "pk": "pay_date", "ids": [pay_date]}]
    if old_head:
        undo_ += [{"op": "restore", "table": "payslip", "rows": old_head},
                  {"op": "restore", "table": "payslip_line", "rows": old_lines}]
    _db.log_change(db, "edit", "payslip", f"{'Edited' if old_head else 'Added'} payslip {pay_date}",
                   pay_date, detail={"undo": undo_})
    db.commit()
    return payslip_get(db, pay_date)
