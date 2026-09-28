"""Turning bank noise into one payee.

Three layers, in order:
  normalise()  strip the varying parts of a description
  rescan()     apply typed rules, in priority order
"""
import re
import sqlite3

from core import db as _db

# Terminal and channel prefixes banks staple on the front.
_PREFIX = re.compile(
    r"^(POS|CRD|CARD|VIS|VISA|CONTACTLESS|CNTLS|BCC|BGC|DD|SO|FPI|FPO|TFR|ATM|"
    r"CHQ|PMT|PAYMENT TO|PAYMENT FROM|DIRECT DEBIT|STANDING ORDER)\s+", re.I)

# Payment processors put themselves in front of the real merchant: 'SQ *THE BEAN'
# is the coffee shop, not Square. No space is guaranteed after the asterisk.
_AGGREGATOR = re.compile(r"^(SQ|IZ|ZTL|PAYPAL|SUMUP|PP|WWW)\s*\*\s*", re.I)

_STRIP = [
    re.compile(r"\*{1,2}\d{3,4}\b"),                    # *8842, **1234
    re.compile(r"\bX{2,}\d{2,4}\b", re.I),              # XXXX1234
    re.compile(r"\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b"),# 12/06, 03-07-26
    re.compile(r"\b\d{1,2}[A-Z]{3}\d{0,4}\b", re.I),    # 12JUN, 12JUN26
    re.compile(r"\bON \d{1,2}\s*\w{3}\b", re.I),        # ON 03 JUL
    # REF first: once the digits are gone a bare 'REF:' would survive
    re.compile(r"\bREF[:.]?\s*\S*", re.I),
    re.compile(r"\b\d{7,}\b"),                          # long reference numbers
    # A trailing 4-6 digit run is a store or terminal number ('TESCO STORES 3411').
    # Three digits are left alone because they are often part of the name itself,
    # as in TRADING 212.
    re.compile(r"\s\d{4,6}\s*$"),
    re.compile(r"\b(LTD|LIMITED|PLC|LLP|INC)\b\.?", re.I),
]

# Country and currency codes banks tack on the end. Applied repeatedly because
# they stack ('... LONDON GB GBP'). Town names are deliberately NOT stripped:
# 'SHELL TRENTHAM' and 'SHELL HANLEY' are the same merchant, and a
# `contains SHELL` rule is the right way to say so — guessing at place names
# would just as happily merge two genuinely different payees.
_TRAIL = re.compile(r"[\s.]*\b(GBR|GBP|GB|UK|USD|EUR)\b[\s.]*$", re.I)

_CLEAN = re.compile(r"[^A-Z0-9&' .-]")
_SPACE = re.compile(r"\s+")


def normalise(description):
    """'POS TRADING 212 UK LTD *8842  LONDON GB' -> 'TRADING 212'

    Keeps enough to identify a payee and drops everything that varies between
    two visits to the same one. The raw description is always kept alongside.
    """
    s = (description or "").upper().strip()
    prev = None
    while prev != s:                       # prefixes can stack: 'POS CRD TESCO'
        prev = s
        s = _PREFIX.sub("", s).strip()
        s = _AGGREGATOR.sub("", s).strip()
    for rx in _STRIP:
        s = rx.sub(" ", s)
    s = _CLEAN.sub(" ", s)
    s = _SPACE.sub(" ", s).strip(" .-'&")
    prev = None
    while prev != s:
        prev = s
        s = _TRAIL.sub("", s).strip(" .-'&")
    return s or (description or "").upper().strip()


# --- matching ----------------------------------------------------------------

def _rule_hit(rule, norm):
    kind, pat = rule["kind"], rule["pattern"]
    if kind == "exact":
        return norm == pat
    if kind == "prefix":
        return norm.startswith(pat)
    if kind == "contains":
        return pat in norm
    if kind == "regex":
        try:
            return re.search(pat, norm, re.I) is not None
        except re.error:
            return False
    return False


def match_one(rules, norm):
    """Lowest priority number wins; longer patterns break a tie. Returns a
    merchant id or None."""
    best = None
    for r in rules:
        if _rule_hit(r, norm):
            key = (r["priority"], -len(r["pattern"]))
            if best is None or key < best[0]:
                best = (key, r["merchant_id"])
    return best[1] if best else None


def rescan(db, only_unlocked=True):
    """Re-derive the payee for every transaction from the current rules.

    Called after an import and after any rule or merchant change, which is what
    makes "edit one rule, all history follows" true. Transactions you assigned
    by hand are locked and left alone.
    """
    rules = [dict(r) for r in db.execute(
        "SELECT merchant_id, kind, pattern, priority FROM match_rule")]
    changed = 0
    where = "WHERE merchant_locked = 0" if only_unlocked else ""
    for row in db.execute(f"SELECT id, description, description_norm, merchant_id "
                          f"FROM txn {where}").fetchall():
        norm = row["description_norm"] or normalise(row["description"])
        hit = match_one(rules, norm)
        if norm != row["description_norm"] or hit != row["merchant_id"]:
            db.execute("UPDATE txn SET description_norm = ?, merchant_id = ? WHERE id = ?",
                       (norm, hit, row["id"]))
            changed += 1
    db.commit()
    return changed


# --- checking a rule before you save it ----------------------------------------

def explain(db, text):
    """What a description cleans up to, and which rule (if any) takes it."""
    norm = normalise(text)
    best = None
    for r in db.execute("SELECT r.*, m.name AS payee FROM match_rule r "
                        "JOIN merchant m ON m.id = r.merchant_id"):
        if _rule_hit(r, norm):
            key = (r["priority"], -len(r["pattern"]))
            if best is None or key < best[0]:
                best = (key, dict(r))
    return {"raw": text, "norm": norm, "rule": best[1] if best else None}


def preview(db, kind, pattern, limit=12):
    """The transactions a rule would catch, before it exists."""
    rule = {"kind": kind, "pattern": (pattern or "").strip().upper()}
    if not rule["pattern"]:
        return {"count": 0, "sample": []}
    hits = [dict(r) for r in db.execute(
        "SELECT id, date, account, description, description_norm, amount, merchant "
        "FROM v_txn ORDER BY date DESC") if _rule_hit(rule, r["description_norm"] or "")]
    return {"count": len(hits), "sample": hits[:limit]}


# --- learning ----------------------------------------------------------------

def learn(db, norm, merchant_id, kind="contains", pattern=None):
    """Sorting a payee writes a rule, so the same payee is sorted once.
    The pattern defaults to the cleaned description."""
    pattern = (pattern or norm).strip().upper()
    if not pattern:
        raise ValueError("a rule needs a pattern")
    db.execute("INSERT OR REPLACE INTO match_rule (merchant_id, kind, pattern, priority) "
               "VALUES (?,?,?,?)",
               (merchant_id, kind, pattern, 10 if kind == "exact" else 100))
    _db.log_change(db, "remap", "match_rule",
                   f"{kind} '{pattern}' → merchant #{merchant_id}")
    db.commit()
    return rescan(db)


def ensure_merchant(db, name, category_id=None, is_internal=0):
    row = db.execute("SELECT id FROM merchant WHERE name = ?", (name,)).fetchone()
    if row:
        if category_id is not None:
            db.execute("UPDATE merchant SET category_id=? WHERE id=?", (category_id, row["id"]))
        return row["id"]
    cur = db.execute("INSERT INTO merchant (name, category_id, is_internal) VALUES (?,?,?)",
                     (name, category_id, is_internal))
    return cur.lastrowid
