"""A valuation out of a statement PDF: the value, the date it was valued, money paid in and
taken out, and whose statement it is. Trading 212 first; anything that labels its figures
("Total value", "Plan value", "Closing balance"…) reads the same way.

    read(pdf_bytes, accounts) -> {value, date, deposits, withdrawals, provider, account_id, amounts, ...}

Nothing is saved here: the page shows what was found and you say yes.
"""
import re
from datetime import date

from core import pdftext

MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
_D = r"(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b"                       # 31.08.2026, 31/08/26
_ISO = r"(\d{4})-(\d{2})-(\d{2})"
_LONG = r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})"     # 30 June 2026
_US = r"([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})"                        # June 30, 2026
DATE = re.compile(f"{_ISO}|{_D}|{_LONG}|{_US}")
PERIOD = re.compile(f"(?:{DATE.pattern})\\s*(?:-|–|—|to|until)\\s*(?:{DATE.pattern})", re.I)
# £1,234.56  -£12.00  (£12.00)  1,234.56 GBP  12.34: not 01.08 out of a date, not 85 on its own
AMOUNT = re.compile(r"(?<![\w.,])([-−(])?\s?(?:£|GBP|€|EUR|\$|USD)?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2})(?![.,]?\d)\)?")

# what each figure is called, most telling first
VALUE = ["account value", "total account value", "total portfolio value", "portfolio value", "total value",
         "plan value", "policy value", "pension value", "fund value", "current value", "closing value",
         "valuation", "net asset value", "equity", "closing balance", "balance"]
DEPOSITS = ["deposits", "deposit", "contributions", "contribution", "payments in", "money in", "paid in"]
WITHDRAWALS = ["withdrawals", "withdrawal", "payments out", "money out", "taken out"]
PROVIDERS = ["Trading 212", "Vanguard", "Hargreaves Lansdown", "AJ Bell", "Freetrade", "InvestEngine", "Fidelity",
             "Moneybox", "Nutmeg", "Chip", "Plum", "Aviva", "Nest", "Scottish Widows", "Legal & General",
             "Royal London", "Standard Life", "Aegon", "PensionBee", "Premium Bonds", "NS&I", "Marcus"]
KINDS = [("stocks isa", "Stocks ISA"), ("stocks & shares isa", "Stocks ISA"), ("stocks and shares isa", "Stocks ISA"),
         ("cash isa", "Cash ISA"), ("lifetime isa", "Lifetime ISA"), ("sipp", "SIPP"), ("pension", "Pension"),
         ("invest", "Invest")]


def _date(m):
    """A DATE match as YYYY-MM-DD, or None if it is not a real date."""
    g = m.groups()
    try:
        if g[0]:
            y, mo, d = int(g[0]), int(g[1]), int(g[2])
        elif g[3]:
            d, mo, y = int(g[3]), int(g[4]), int(g[5])
            y += 2000 if y < 100 else 0
        elif g[6]:
            d, mo, y = int(g[6]), MONTHS.get(g[7][:3].lower()), int(g[8])
        else:
            mo, d, y = MONTHS.get(g[9][:3].lower()), int(g[10]), int(g[11])
        return date(y, mo, d).isoformat() if mo else None
    except (ValueError, TypeError):
        return None


def _amount(m):
    v = float(m.group(2).replace(",", ""))
    return -v if m.group(1) else v


def _find(labelled, names):
    """The first line whose label is one of names (a whole-word match), in the order of names.
    An opening or previous figure is never the one wanted."""
    for name in names:
        for label, v in labelled:
            if re.search(rf"(^|\b){re.escape(name)}\b", label) and not re.search(r"\b(opening|previous|last month)\b", label):
                return label, v
    return None, None


def parse(text, today=None):
    """What a statement's text says (see read)."""
    today = today or date.today().isoformat()
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    labelled = []
    for ln in lines:
        ms = [m for m in AMOUNT.finditer(ln) if not DATE.match(ln, m.start())]
        if not ms:
            continue
        label = re.sub(r"[\s:.\-–]+$", "", ln[:ms[0].start()]).strip().lower()
        if label and not re.search(r"\d{4}", label):              # a line of figures under a date is not a label
            labelled.append((label, _amount(ms[-1])))
    low = text.lower()
    # the date it was valued: "as at …", the end of "… to …", else the latest date that has passed
    when = None
    m = re.search(r"(?:as at|as of|valuation date|valued on|statement date|value date)\s*:?\s*(" + DATE.pattern + ")", text, re.I)
    if m:
        when = _date(DATE.match(m.group(1)))
    if not when:
        for m in PERIOD.finditer(text):
            when = _date(list(DATE.finditer(m.group(0)))[-1])
            if when:
                break
    if not when:
        seen = sorted(d for d in (_date(x) for x in DATE.finditer(text)) if d and d <= today)
        when = seen[-1] if seen else None
    period = None
    m = PERIOD.search(text)
    if m:
        ds = [_date(x) for x in DATE.finditer(m.group(0))]
        period = [ds[0], ds[-1]] if len(ds) >= 2 and all(ds) else None
    vlabel, value = _find(labelled, VALUE)
    _, dep = _find(labelled, DEPOSITS)
    _, wd = _find(labelled, WITHDRAWALS)
    provider = next((p for p in PROVIDERS if p.lower() in low), None)
    kind = next((k for key, k in KINDS if key in low), None)
    return {"value": value, "value_label": vlabel, "date": when, "period": period,
            "deposits": dep, "withdrawals": abs(wd) if wd is not None else None,
            "provider": provider, "account_type": kind,
            "amounts": [{"label": lb, "amount": v} for lb, v in labelled[:60]]}


def match_account(found, accounts):
    """The account this statement is most likely for: its provider in the account's name or
    provider, and the kind (ISA, pension) agreeing. None when nothing fits."""
    best, score = None, 0
    for a in accounts:
        hay = f"{a['name']} {a.get('provider') or ''}".lower()
        s = 0
        if found.get("provider") and found["provider"].lower() in hay:
            s += 2
        t = (found.get("account_type") or "").lower()
        if t and ("isa" in t) == ("isa" in hay):
            s += 1
        if t in ("sipp", "pension") and a.get("kind") == "pension":
            s += 1
        if s > score:
            best, score = a["id"], s
    return best if score >= 2 else None


def read(data, accounts=()):
    text = pdftext.text(data)
    out = parse(text)
    out["account_id"] = match_account(out, accounts)
    out["text"] = text[:6000]
    return out
