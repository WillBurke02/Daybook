"""Log: a diary of the day and the work day, with photos and voice notes.

Log keeps no reminders: it is for logging the day. Bills and anything else that
comes round live in Money.
"""
import base64
import os
import re
from datetime import date, datetime

from core import db as _db
from core.api import Err

HERE = os.path.dirname(os.path.abspath(__file__))
NAME, TITLE, ORDER = "log", "Log", 2
MIGRATIONS = os.path.join(HERE, "migrations")
VIEWS = os.path.join(HERE, "views.sql")
SIGNATURE = "entry"
SOURCES = {
    "v_entry": ["Entries", "Every entry: its day, time, kind (diary or work), text and tags, and how many photos and voice notes."],
    "v_log_day": ["Days logged", "One row a day with anything logged: work entries, whether there is a diary, entries in all."],
    "v_tag": ["Tags", "Every tag, how often and when it was last used."],
    "v_attachment": ["Photos and voice notes", "Each attachment, without the picture or sound itself."],
}
OTHERS = ("money", "learn")
LABELS = {"entry": "entry", "attachment": "attachment"}
SHARE_MAX = 25 * 1024 * 1024        # one shared file; larger ones are refused, not truncated
SYNC_SKIP = ("inbox",)              # a shared photo waits here until Log files it; the filed one syncs

SEARCH = [
    ("entry", "SELECT e.id, e.day AS date, e.at, e.kind, e.text, e.tags, "
              "(SELECT thumb FROM attachment a WHERE a.entry_id = e.id AND a.thumb IS NOT NULL ORDER BY a.id LIMIT 1) AS thumb "
              "FROM entry e", ["e.text", "e.tags", "e.day"], None, "date DESC, at DESC"),
]

TAG = re.compile(r"#([^\W_][\w-]*)")


def tags_of(text):
    """'Swapped the PLC #site #TS247' -> ' site ts247 ': padded so '% site %' never matches part of a tag."""
    found = sorted({t.lower() for t in TAG.findall(text or "")})
    return f" {' '.join(found)} " if found else None


def before_write(db, name, row):
    if name == "entry" and "text" in row:
        row["tags"] = tags_of(row["text"])
    if name == "entry" and row.get("id"):
        row["updated"] = datetime.now().strftime("%Y-%m-%d %H:%M")


def sync_merge(db, name, mine, theirs):
    """The same day's diary started on two computers before they synced: keep both
    texts, in an order both work out the same way, so neither computer's is lost."""
    if name != "entry" or mine.get("kind") != "day" or not mine.get("text") or not theirs.get("text"):
        return None
    a, b = mine["text"], theirs["text"]
    if b in a or a in b:
        text = a if len(a) >= len(b) else b
    else:
        text = "\n\n".join(sorted((a, b)))
    return {"text": text, "tags": tags_of(text)}


# --- adding ------------------------------------------------------------------------

def add(db, text=None, kind="work", day=None, at=None, photos=(), voice=None, log=True):
    """One entry for a day, or, for kind 'day', more text on that day's diary.
    photos: [{image, thumb}] already shrunk in the browser; voice: {data, duration_s}.
    Returns the entry's id. Undo takes back everything it did."""
    day = day or date.today().isoformat()
    text = (text or "").strip() or None
    if kind not in ("day", "work"):
        raise Err(400, "kind is day or work")
    if not text and not photos and not voice:
        raise Err(400, "write something, or add a photo or a voice note")
    undo = []
    diary = db.execute("SELECT * FROM entry WHERE day = ? AND kind = 'day'", (day,)).fetchone() if kind == "day" else None
    if diary:
        eid = diary["id"]
        undo.append({"op": "restore", "table": "entry", "rows": [dict(diary)]})
        if text:
            joined = ((diary["text"] or "").rstrip() + "\n\n" + (f"{at} " if at else "") + text).strip()
            db.execute("UPDATE entry SET text = ?, tags = ?, updated = ? WHERE id = ?",
                       (joined, tags_of(joined), datetime.now().strftime("%Y-%m-%d %H:%M"), eid))
    else:
        eid = db.execute("INSERT INTO entry (day, at, kind, text, tags) VALUES (?,?,?,?,?)",
                         (day, None if kind == "day" else at, kind, text, tags_of(text))).lastrowid
        undo.append({"op": "remove", "table": "entry", "pk": "id", "ids": [eid]})
    ids = []
    for p in photos:
        ids.append(db.execute("INSERT INTO attachment (entry_id, type, data, thumb) VALUES (?, 'photo', ?, ?)",
                              (eid, p["image"], p.get("thumb"))).lastrowid)
    if voice:
        ids.append(db.execute("INSERT INTO attachment (entry_id, type, data, duration_s) VALUES (?, 'voice', ?, ?)",
                              (eid, voice["data"], round(float(voice.get("duration_s") or 0), 1))).lastrowid)
    if ids:
        undo.insert(0, {"op": "remove", "table": "attachment", "pk": "id", "ids": ids})
    if log:
        what = "diary" if kind == "day" else "entry"
        _db.log_change(db, "edit", "entry", f"Logged {what} for {day}" + (f", {len(ids)} attached" if ids else ""),
                       eid, detail={"undo": undo})
    db.commit()
    return eid


def share(db, fields, files):
    """A phone's share sheet: text and pictures become an entry for today. The
    pictures wait in the inbox until Log is next open, which shrinks them."""
    text = "\n".join(v.strip() for k in ("title", "text", "url") if (v := fields.get(k)) and v.strip())
    pics = [(m, d) for m, d in files if m.startswith("image/") and len(d) <= SHARE_MAX]
    if not text and not pics:
        return "/log/#/day"
    eid = db.execute("INSERT INTO entry (day, at, kind, text, tags) VALUES (?,?,?,?,?)",
                     (date.today().isoformat(), datetime.now().strftime("%H:%M"), "work", text or None, tags_of(text))).lastrowid
    for m, d in pics:
        db.execute("INSERT INTO inbox (entry_id, mime, data) VALUES (?,?,?)",
                   (eid, m, f"data:{m};base64,{base64.b64encode(d).decode()}"))
    _db.log_change(db, "edit", "entry", f"Shared to Log{f', {len(pics)} picture(s)' if pics else ''}", eid,
                   detail={"undo": [{"op": "remove", "table": "entry", "pk": "id", "ids": [eid]}]})
    db.commit()
    return f"/log/#/day?d={date.today().isoformat()}"


# --- what the suite asks of every app -------------------------------------------------

def home(db):
    today = date.today().isoformat()
    n = db.execute("SELECT COUNT(*) FROM entry WHERE day = ? AND (kind = 'work' OR TRIM(COALESCE(text,'')) <> '')",
                   (today,)).fetchone()[0]
    recent = db.execute("SELECT id, day, at, kind, text FROM entry WHERE TRIM(COALESCE(text,'')) <> '' "
                        "ORDER BY day DESC, COALESCE(at, '99') DESC, id DESC LIMIT 3").fetchall()
    return {"figures": [{"label": "Today", "value": str(n), "sub": "entries" if n != 1 else "entry", "href": "#/day"}],
            "items_title": "Latest", "items_empty": "Nothing logged yet.",
            "items": [{"when": f"{r['day'][8:]}/{r['day'][5:7]}" + (f" {r['at']}" if r["at"] else ""),
                       "text": (r["text"] or "").split("\n")[0][:90], "href": f"#/day?d={r['day']}&e={r['id']}"} for r in recent],
            "quick": {"placeholder": "Add to today's log (Ctrl+Enter)", "post": "quick", "done": "Added to today"},
            "links": [{"label": "Today", "href": "#/day"}, {"label": "Timeline", "href": "#/timeline"}]}


def inspect(count, span):
    s = lambda sp: f" · {sp[0]} to {sp[1]}" if sp and sp[0] else ""
    return [["Entries", f"{count('entry')}{s(span('entry', 'day'))}"], ["Photos and voice notes", str(count("attachment"))]]


# --- Log's own endpoints ------------------------------------------------------------------

def route(db, method, p, query, body, ctx):
    g = lambda k, d=None: (query.get(k) or [d])[0]

    if p == ["quick"] and method == "POST":
        now = datetime.now()
        eid = add(db, body.get("text"), body.get("kind") or "work", body.get("day") or now.date().isoformat(),
                  body.get("at") if "at" in body else now.strftime("%H:%M"), body.get("photos") or (), body.get("voice"))
        return 200, {"ok": True, "id": eid}

    if p[:1] == ["attach"] and len(p) == 2 and method == "POST":
        e = db.execute("SELECT * FROM entry WHERE id = ?", (int(p[1]),)).fetchone()
        if not e:
            raise Err(404, "no such entry")
        ids = []
        for ph in body.get("photos") or ():
            ids.append(db.execute("INSERT INTO attachment (entry_id, type, data, thumb) VALUES (?, 'photo', ?, ?)",
                                  (e["id"], ph["image"], ph.get("thumb"))).lastrowid)
        if body.get("voice"):
            v = body["voice"]
            ids.append(db.execute("INSERT INTO attachment (entry_id, type, data, duration_s) VALUES (?, 'voice', ?, ?)",
                                  (e["id"], v["data"], round(float(v.get("duration_s") or 0), 1))).lastrowid)
        if not ids:
            raise Err(400, "nothing to attach")
        for i in body.get("inbox") or ():            # shrunk from the inbox: those rows are done with
            db.execute("DELETE FROM inbox WHERE id = ?", (int(i),))
        _db.log_change(db, "edit", "attachment", f"Added {len(ids)} to the entry of {e['day']}", e["id"],
                       detail={"undo": [{"op": "remove", "table": "attachment", "pk": "id", "ids": ids}]})
        db.commit()
        return 200, {"ok": True, "ids": ids}

    if p == ["day"] and method == "GET":
        d = g("d") or date.today().isoformat()
        entries = [dict(r) for r in db.execute(
            "SELECT * FROM entry WHERE day = ? ORDER BY kind = 'work', COALESCE(at, '99:99'), id", (d,))]
        ids = [e["id"] for e in entries]
        atts = [dict(r) for r in db.execute(
            f"SELECT * FROM v_attachment WHERE entry_id IN ({','.join('?' * len(ids))}) ORDER BY id", ids)] if ids else []
        for e in entries:
            e["attachments"] = [a for a in atts if a["entry_id"] == e["id"]]
        near = db.execute("SELECT (SELECT MAX(day) FROM entry WHERE day < ?), (SELECT MIN(day) FROM entry WHERE day > ?)",
                          (d, d)).fetchone()
        return 200, {"day": d, "entries": entries, "prev": near[0], "next": near[1],
                     "inbox": [dict(r) for r in db.execute("SELECT i.* FROM inbox i")]}

    if p == ["timeline"] and method == "GET":
        before, tag = g("before", "9999-12-31"), (g("tag") or "").lower().lstrip("#")
        limit = min(int(g("limit", 30)), 200)
        where, args = "day < ?", [before]
        if tag:
            where += " AND tags LIKE ?"
            args.append(f"% {tag} %")
        days = [r[0] for r in db.execute(f"SELECT DISTINCT day FROM entry WHERE {where} ORDER BY day DESC LIMIT ?",
                                         args + [limit])]
        out = []
        for d in days:
            rows = db.execute(f"SELECT * FROM v_entry WHERE day = ? {'AND tags LIKE ?' if tag else ''} "
                              "ORDER BY kind = 'work', COALESCE(at, '99:99'), id", [d] + ([f"% {tag} %"] if tag else [])).fetchall()
            thumbs = [r[0] for r in db.execute(
                "SELECT a.thumb FROM attachment a JOIN entry e ON e.id = a.entry_id WHERE e.day = ? AND a.thumb IS NOT NULL "
                "ORDER BY a.id LIMIT 6", (d,))]
            out.append({"day": d, "thumbs": thumbs,
                        "lines": [{"at": r["at"], "kind": r["kind"], "text": (r["text"] or "").strip().split("\n")[0][:160],
                                   "photos": r["photos"], "voices": r["voices"]} for r in rows]})
        return 200, {"days": out, "more": len(days) == limit}

    if p == ["print"] and method == "GET":
        frm, to = g("from") or date.today().isoformat(), g("to") or g("from") or date.today().isoformat()
        entries = [dict(r) for r in db.execute(
            "SELECT * FROM entry WHERE day BETWEEN ? AND ? ORDER BY day, kind = 'work', COALESCE(at, '99:99'), id", (frm, to))]
        for e in entries:
            e["photos"] = [r[0] for r in db.execute(
                "SELECT data FROM attachment WHERE entry_id = ? AND type = 'photo' ORDER BY id", (e["id"],))]
            e["voices"] = db.execute("SELECT COUNT(*) FROM attachment WHERE entry_id = ? AND type = 'voice'",
                                     (e["id"],)).fetchone()[0]
        return 200, {"from": frm, "to": to, "entries": entries}
    return None
