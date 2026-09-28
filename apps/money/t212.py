"""Trading 212's history CSV (History → Export in the app or on the web).

Deposits and withdrawals become money put in and taken out (contribution) of the account you
pick. Each keeps Trading 212's own transaction id in its note, so importing the same file
again, or a later one that overlaps it, adds nothing twice. Dividends and interest are added
up and shown, not recorded: they are growth, which the valuations already show. Trades are
counted. Money is in pounds: a payment in another currency is listed and left out.
"""
import csv
import io
import re

NOTE = "Trading 212 "


def _num(v):
    try:
        return float(str(v or "0").replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


def read(text):
    """The file as {payments: [{date, amount, id}], foreign: [...], dividends, interest, buys, sells, other, first, last}."""
    rows = list(csv.DictReader(io.StringIO(str(text).lstrip("﻿"))))
    if not rows or "Action" not in rows[0]:
        raise ValueError("That is not a Trading 212 history CSV: it has no Action column.")
    total = next((k for k in rows[0] if k == "Total" or (k or "").startswith("Total (")), None)
    if not total:
        raise ValueError("That Trading 212 CSV has no Total column.")
    fixed = re.search(r"\((\w{3})\)", total)
    out = {"payments": [], "foreign": [], "dividends": 0.0, "interest": 0.0, "buys": 0, "sells": 0, "other": 0}
    days = []
    for r in rows:
        act = (r.get("Action") or "").strip().lower()
        day = (r.get("Time") or "").strip()[:10]
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            continue
        days.append(day)
        amount = _num(r.get(total))
        cur = (r.get("Currency (Total)") or (fixed.group(1) if fixed else "GBP")).strip().upper()
        if act in ("deposit", "withdrawal"):
            p = {"date": day, "amount": round(abs(amount) * (1 if act == "deposit" else -1), 2),
                 "id": (r.get("ID") or "").strip() or f"{act} {day} {abs(amount):.2f}", "currency": cur}
            (out["payments"] if cur == "GBP" else out["foreign"]).append(p)
        elif act.startswith("dividend"):
            out["dividends"] += amount if cur == "GBP" else 0
        elif "interest" in act:
            out["interest"] += amount if cur == "GBP" else 0
        elif "buy" in act:
            out["buys"] += 1
        elif "sell" in act:
            out["sells"] += 1
        else:
            out["other"] += 1
    out["dividends"], out["interest"] = round(out["dividends"], 2), round(out["interest"], 2)
    out["first"], out["last"] = (min(days), max(days)) if days else (None, None)
    return out


def plan(db, account_id, text):
    """What importing would do for this account: the payments not recorded yet, and the rest counted."""
    got = read(text)
    have = {r[0] for r in db.execute("SELECT note FROM contribution WHERE account_id = ? AND note LIKE ?", (account_id, NOTE + "%"))}
    new = [p for p in got["payments"] if NOTE + p["id"] not in have]
    return dict(got, new=new, already=len(got["payments"]) - len(new))


def commit(db, account_id, text):
    from core import db as _db
    p = plan(db, account_id, text)
    ids = [db.execute("INSERT INTO contribution (account_id, date, amount, note) VALUES (?, ?, ?, ?)",
                      (account_id, x["date"], x["amount"], NOTE + x["id"])).lastrowid for x in p["new"]]
    if ids:
        _db.log_change(db, "import", "contribution", f"Trading 212: {len(ids)} payment{'s' if len(ids) != 1 else ''} in and out",
                       detail={"undo": [{"op": "remove", "table": "contribution", "pk": "id", "ids": ids}]}, rows=len(ids))
    db.commit()
    return dict(p, added=len(ids))
