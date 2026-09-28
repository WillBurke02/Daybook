"""Statements in.

Two jobs that used to share one cramped form:
  plan_one()   the latest statement for one account
  plan_bulk()  years of history across every account, laid out before anything
               is written

Nothing here writes until a plan has been produced and accepted. The sign
convention is the thing most likely to be wrong, so every plan reports which
direction the money went before you commit it.
"""
import csv
import hashlib
import io
import json
import os
import re
from datetime import datetime

from core import db as _db
from . import matching

MONTHS = ["jan", "feb", "mar", "apr", "may", "jun",
          "jul", "aug", "sep", "oct", "nov", "dec"]


# --- reading the file --------------------------------------------------------

def parse_csv(text):
    if text.startswith("﻿"):
        text = text[1:]
    # Some banks preface the rows with a few "Account: ..." lines. Find the real
    # header: the first line with the most delimiters that is followed by data.
    rows = list(csv.reader(io.StringIO(text)))
    rows = [r for r in rows if any(c.strip() for c in r)]
    if not rows:
        return [], []
    widest = max(len(r) for r in rows)
    start = next((i for i, r in enumerate(rows) if len(r) == widest), 0)
    return rows[start], rows[start + 1:]


def norm_date(s, style="dmy"):
    s = (s or "").strip()
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y, mo, d = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    m = re.match(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})", s)
    if m:
        a, b, y = m.groups()
        y = ("20" + y) if len(y) == 2 else y
        d, mo = (b, a) if style == "mdy" else (a, b)
        try:
            datetime(int(y), int(mo), int(d))
        except ValueError:
            return None
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    m = re.match(r"^(\d{1,2})[ \-]([A-Za-z]{3})[a-z]*[ \-](\d{2,4})", s)
    if m:
        d, mon, y = m.groups()
        if mon.lower() in MONTHS:
            y = ("20" + y) if len(y) == 2 else y
            return f"{y}-{MONTHS.index(mon.lower()) + 1:02d}-{int(d):02d}"
    return None


def num(v):
    """Money as banks write it: 1,234.56 · £45 · (45.20) · 45.20 DR · 45.20-"""
    s = str(v if v is not None else "").strip()
    if not s:
        return 0.0
    neg = False
    if re.match(r"^\(.*\)$", s):
        neg, s = True, s[1:-1]
    if re.search(r"\bDR\b", s, re.I):
        neg = True
    if re.search(r"-\s*$", s):
        neg, s = True, re.sub(r"-\s*$", "", s)
    s = re.sub(r"[^0-9.\-]", "", s)
    if s.startswith("-"):
        neg, s = True, s[1:]
    try:
        n = float(s)
    except ValueError:
        return 0.0
    return -n if neg else n


def header_hash(header):
    key = "|".join(re.sub(r"[^a-z0-9]", "", (h or "").lower()) for h in header)
    return hashlib.sha256(key.encode()).hexdigest()[:32]


def guess_mapping(header):
    low = [re.sub(r"[^a-z]", "", (h or "").lower()) for h in header]

    def find(*names):
        for i, h in enumerate(low):
            if h and any(n in h for n in names):
                return i
        return -1

    amount = find("amount", "value")
    paid_in = find("paidin", "moneyin", "credit", "received")
    paid_out = find("paidout", "moneyout", "debit", "withdraw")
    return {
        "date": max(0, find("date")),
        "description": max(0, find("description", "reference", "details", "narrative",
                                   "payee", "memo", "transaction", "merchant")),
        "amount": amount,
        "paid_in": paid_in,
        "paid_out": paid_out,
        "balance": find("balance"),
        "style": "signed" if amount >= 0 else "inout",
    }


# --- planning ----------------------------------------------------------------

def plan_one(db, text, filename, account_id=None, mapping=None, flip=False,
             opening=None, closing=None, period_start=None, period_end=None,
             date_style=None):
    """Everything the UI needs to show before a single file is committed. The
    account is always yours to choose; the column mapping is remembered per
    bank layout and can be changed in the preview."""
    digest = hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()
    dup = db.execute("SELECT id, filename, imported_at FROM statement WHERE content_hash = ?",
                     (digest,)).fetchone()

    header, body = parse_csv(text)
    profile = db.execute("SELECT * FROM format_profile WHERE header_hash = ?",
                         (header_hash(header),)).fetchone()
    if mapping is None:
        mapping = json.loads(profile["mapping"]) if profile else guess_mapping(header)
    style = mapping.get("style", "signed")
    date_style = date_style or (profile["date_style"] if profile else "dmy")

    rows, skipped, sample = [], 0, []
    for r in body:
        def cell(i):
            return r[i] if 0 <= i < len(r) else ""
        d = norm_date(cell(mapping["date"]), date_style)
        if not d:
            skipped += 1
            continue
        if style == "inout":
            amt = num(cell(mapping.get("paid_in", -1))) - abs(num(cell(mapping.get("paid_out", -1))))
        else:
            amt = num(cell(mapping["amount"]))
        if flip:
            amt = -amt
        if not amt:
            skipped += 1
            continue
        desc = (cell(mapping["description"]) or "").strip() or "(no description)"
        rows.append({"date": d, "description": desc, "amount": round(amt, 2),
                     "description_norm": matching.normalise(desc)})

    rows.sort(key=lambda x: x["date"])
    money_in = [r for r in rows if r["amount"] > 0]
    money_out = [r for r in rows if r["amount"] < 0]
    in_total = round(sum(r["amount"] for r in money_in), 2)
    out_total = round(-sum(r["amount"] for r in money_out), 2)

    ps = period_start or (rows[0]["date"] if rows else None)
    pe = period_end or (rows[-1]["date"] if rows else None)
    movement = round(sum(r["amount"] for r in rows), 2)
    recon = None
    if opening is not None and closing is not None:
        recon = round(closing - (opening + movement), 2)

    return {
        "filename": os.path.basename(filename),
        "content_hash": digest,
        "duplicate": dict(dup) if dup else None,
        "account_id": account_id,
        "header": header,
        "mapping": mapping,
        "profile": profile["name"] if profile else None,
        "date_style": date_style,
        "rows": rows,
        "count": len(rows),
        "skipped": skipped,
        "money_in": len(money_in), "money_out": len(money_out),
        "in_total": in_total, "out_total": out_total,
        "movement": movement,
        "period_start": ps, "period_end": pe,
        "opening_balance": opening, "closing_balance": closing,
        "discrepancy": recon,
        "reconciles": (recon is not None and abs(recon) < 0.01),
        "sample": rows[:8],
    }


def commit(db, plan, make_current=True, save_profile_as=None):
    """Write a planned statement. Refuses a duplicate and an unassigned account."""
    if plan.get("duplicate"):
        raise ValueError(f"already imported as {plan['duplicate']['filename']} "
                         f"on {plan['duplicate']['imported_at']}")
    if not plan.get("account_id"):
        raise ValueError("choose an account for this statement")
    if not plan["rows"]:
        raise ValueError("no rows could be read — check the column mapping")

    demoted = [r[0] for r in db.execute(
        "SELECT id FROM statement WHERE account_id=? AND role='current'", (plan["account_id"],))]
    if make_current:
        db.execute("UPDATE statement SET role='history' WHERE account_id=? AND role='current'",
                   (plan["account_id"],))
    cur = db.execute(
        "INSERT INTO statement (account_id, filename, period_start, period_end, "
        " opening_balance, closing_balance, row_count, content_hash, role) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (plan["account_id"], plan["filename"], plan["period_start"], plan["period_end"],
         plan.get("opening_balance"), plan.get("closing_balance"), plan["count"],
         plan["content_hash"], "current" if make_current else "history"))
    sid = cur.lastrowid
    db.executemany(
        "INSERT INTO txn (account_id, date, description, amount, description_norm, statement_id) "
        "VALUES (?,?,?,?,?,?)",
        [(plan["account_id"], r["date"], r["description"], r["amount"],
          r["description_norm"], sid) for r in plan["rows"]])

    if save_profile_as and plan.get("header"):
        db.execute("INSERT OR IGNORE INTO format_profile "
                   "(name, header_hash, mapping, date_style, amount_style, account_id) "
                   "VALUES (?,?,?,?,?,?)",
                   (save_profile_as, header_hash(plan["header"]), json.dumps(plan["mapping"]),
                    plan.get("date_style", "dmy"),
                    plan["mapping"].get("style", "signed"), plan["account_id"]))
    db.execute("UPDATE format_profile SET used_count = used_count + 1 WHERE header_hash = ?",
               (header_hash(plan.get("header") or []),))

    _db.log_change(db, "import", "statement",
                   f"Imported {plan['filename']}: {plan['count']} rows, "
                   f"{plan['period_start']} to {plan['period_end']}",
                   entity_id=sid, rows=plan["count"], detail={"undo": [
                       {"op": "remove_where", "table": "txn", "where": {"statement_id": sid}},
                       {"op": "remove", "table": "statement", "pk": "id", "ids": [sid]}]
                       + ([{"op": "restore", "table": "statement",
                            "rows": [{"id": i, "role": "current"} for i in demoted]}]
                          if make_current else [])})
    db.commit()
    matching.rescan(db)
    return sid


def plan_bulk(db, files):
    """files: [(filename, text, account_id)]. Groups by account and reports the
    whole set — gaps, overlaps, duplicates — before anything is written."""
    plans, dupes = [], []
    for name, text, account_id in files:
        p = plan_one(db, text, name, account_id=account_id)
        (dupes if p["duplicate"] else plans).append(p)

    by_account = {}
    for p in plans:
        by_account.setdefault(p["account_id"], []).append(p)

    groups = []
    for aid, ps in by_account.items():
        ps.sort(key=lambda x: x["period_start"] or "")
        acc = db.execute("SELECT name FROM account WHERE id = ?", (aid,)).fetchone() if aid else None
        gaps = []
        for a, b in zip(ps, ps[1:]):
            if a["period_end"] and b["period_start"]:
                d = (datetime.fromisoformat(b["period_start"])
                     - datetime.fromisoformat(a["period_end"])).days - 1
                if d > 0:
                    gaps.append({"from": a["period_end"], "to": b["period_start"], "days": d})
                elif d < 0:
                    gaps.append({"from": b["period_start"], "to": a["period_end"], "days": d,
                                 "overlap": True})
        groups.append({
            "account_id": aid,
            "account": acc["name"] if acc else "No account chosen",
            "files": len(ps),
            "period_start": ps[0]["period_start"], "period_end": ps[-1]["period_end"],
            "rows": sum(p["count"] for p in ps),
            "money_in": sum(p["money_in"] for p in ps),
            "money_out": sum(p["money_out"] for p in ps),
            "gaps": gaps,
            "plans": ps,
        })
    groups.sort(key=lambda g: (g["account_id"] is None, g["account"]))
    return {
        "groups": groups,
        "duplicates": [{"filename": p["filename"],
                        "already": p["duplicate"]["filename"]} for p in dupes],
        "total_files": len(files),
        "total_rows": sum(g["rows"] for g in groups),
        "unassigned": sum(1 for g in groups if g["account_id"] is None),
    }


def commit_bulk(db, plan, newest_current=True):
    """Writes every planned file. The newest per account becomes current."""
    written = 0
    for g in plan["groups"]:
        if not g["account_id"]:
            continue
        for i, p in enumerate(g["plans"]):
            last = (i == len(g["plans"]) - 1)
            commit(db, p, make_current=bool(newest_current and last))
            written += 1
    return written
