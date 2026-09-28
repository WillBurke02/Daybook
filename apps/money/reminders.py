"""Reminders and regular bills.

A reminder has a first due date and a repeat. The next one due is the first
date in that series not yet dealt with: ticked off by hand (done_through), or,
for a bill tied to a payee, paid to that payee within a week of the date.

Regular payments are only suggested, never added by themselves: a payee paid
about the same amount at a steady interval, lately.
"""
import calendar
from datetime import date, timedelta
from statistics import median

MONTHS = {"month": 1, "quarter": 3, "year": 12}
NEAR = 7            # a payment this many days either side of the date settles it
CADENCE = [("week", 6, 8, 4), ("month", 26, 35, 3), ("quarter", 85, 97, 3), ("year", 350, 380, 2)]


def nth(start, every, k):
    """The k-th date of the series. Months keep the day: the 31st falls to the 30th or 28th, then back."""
    d = date.fromisoformat(start)
    if every == "week":
        return d + timedelta(days=7 * k)
    y, m = divmod(d.month - 1 + MONTHS[every] * k, 12)
    y, m = d.year + y, m + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def upcoming(db, today=None):
    today = today or date.today()
    out = []
    for r in db.execute("SELECT r.*, m.name AS payee FROM reminder r "
                        "LEFT JOIN merchant m ON m.id = r.merchant_id ORDER BY r.start, r.id"):
        r = dict(r)
        paid = [(date.fromisoformat(x["date"]), -x["amount"]) for x in db.execute(
            "SELECT date, amount FROM txn WHERE merchant_id = ? AND amount < 0 ORDER BY date",
            (r["merchant_id"],))] if r["merchant_id"] else []
        done = date.fromisoformat(r["done_through"]) if r["done_through"] else None
        due = None
        for k in range(5000):                  # ponytail: walks the series from the start; fine for decades of weekly
            d = nth(r["start"], r["every"], k) if r["every"] != "once" else date.fromisoformat(r["start"])
            if (done and d <= done) or (d <= today + timedelta(days=NEAR)
                                        and any(abs((p - d).days) <= NEAR for p, _ in paid)):
                if r["every"] == "once":
                    break
                continue
            due = d
            break
        r["next_due"] = due.isoformat() if due else None
        r["days"] = (due - today).days if due else None
        r["last_paid"], r["last_amount"] = (paid[-1][0].isoformat(), round(paid[-1][1], 2)) if paid else (None, None)
        out.append(r)
    return sorted(out, key=lambda r: (r["next_due"] is None, r["next_due"] or ""))


def per_month(r):
    """What a repeating amount costs in an average month."""
    a = r.get("amount") or 0
    return {"week": a * 52 / 12, "month": a, "quarter": a / 3, "year": a / 12}.get(r["every"], 0)


def suggest(db, today=None):
    """Payees paid a steady amount at a steady interval, still going, not already a reminder."""
    today = today or date.today()
    have = {r[0] for r in db.execute("SELECT merchant_id FROM reminder WHERE merchant_id IS NOT NULL")}
    by = {}
    for r in db.execute("SELECT merchant_id, merchant, date, amount FROM v_txn WHERE merchant_id IS NOT NULL "
                        "AND amount < 0 AND category_kind IN ('spend', 'unmatched') ORDER BY date"):
        if r["merchant_id"] not in have:
            by.setdefault((r["merchant_id"], r["merchant"]), []).append((date.fromisoformat(r["date"]), -r["amount"]))
    out = []
    for (mid, name), pays in by.items():
        for every, lo, hi, need in CADENCE:
            last = pays[-need:]
            if len(last) < need or (today - last[-1][0]).days > hi + 10:
                continue
            gaps = [(b[0] - a[0]).days for a, b in zip(last, last[1:])]
            mid_amount = median(a for _, a in last)
            if all(lo <= g <= hi for g in gaps) and all(abs(a - mid_amount) <= 0.15 * mid_amount for _, a in last):
                out.append({"merchant_id": mid, "name": name, "every": every, "amount": round(last[-1][1], 2),
                            "last": last[-1][0].isoformat(), "next": nth(last[-1][0].isoformat(), every, 1).isoformat()})
                break
    return sorted(out, key=lambda s: -s["amount"])
