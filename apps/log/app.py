"""Log: a diary of the day and the work day, with photos and voice notes.

An entry can carry one reminder (!fri, !tomorrow 9:00): it shows on its day and in the
calendar feed. Bills and anything else that comes round live in Money.
"""
import base64
import os
import re
from datetime import date, datetime, timedelta

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
    "v_tag": ["Tags", "Every tag, how often and when it was last used, and its note."],
    "v_attachment": ["Photos and voice notes", "Each attachment, without the picture or sound itself."],
}
OTHERS = ("money", "learn")
LABELS = {"entry": "entry", "attachment": "attachment", "clip": "video"}
SHARE_MAX = 25 * 1024 * 1024        # one shared file; larger ones are refused, not truncated
CLIP_MAX = 60 * 1024 * 1024         # one video: about a minute from a phone; trim a longer one there first
CLIP_KEEP = 30                      # days a deleted video's bytes wait, in case the delete is undone
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


DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
REMIND = re.compile(r"(?<![\w!])!(today|tomorrow|tmrw|monday|tuesday|wednesday|thursday|friday|saturday|sunday"
                    r"|mon|tues|tue|wed|thurs|thu|fri|sat|sun|\d{1,2}/\d{1,2}(?:/\d{2,4})?|\d{1,3}[dw])"
                    r"(?:\s+(\d{1,2}(?::\d{2})?\s*[ap]m|\d{1,2}:\d{2}))?(?![\w/])", re.I)


def remind_of(text, day):
    """'Order bearings !fri 9am', written on Wed 2026-10-14 -> '2026-10-16 09:00'. When is from the entry's
    own day: !fri is the next Friday after it, !16/10 the next 16 October from it, !3d three days on,
    !2w a fortnight. ponytail: the first ! in the text only; one reminder an entry."""
    m = REMIND.search(text or "")
    if not m:
        return None
    w, t = m.group(1).lower(), m.group(2)
    base = date.fromisoformat(day)
    if w == "today":
        d = base
    elif w in ("tomorrow", "tmrw"):
        d = base + timedelta(days=1)
    elif w[:3] in DAYS and not w[0].isdigit():
        d = base + timedelta(days=(DAYS.index(w[:3]) - base.weekday() - 1) % 7 + 1)
    elif w[-1] in "dw":
        d = base + timedelta(days=int(w[:-1]) * (7 if w[-1] == "w" else 1))
    else:
        parts = [int(x) for x in w.split("/")]
        y = parts[2] if len(parts) == 3 else base.year
        y += 2000 if y < 100 else 0
        try:
            d = date(y, parts[1], parts[0])
            if len(parts) == 2 and d < base:
                d = date(y + 1, parts[1], parts[0])
        except ValueError:
            return None                              # !31/02 is not a day
    if not t:
        return d.isoformat()
    hm = re.match(r"(\d{1,2})(?::(\d{2}))?\s*([ap]m)?", t.lower())
    h, mi = int(hm.group(1)), int(hm.group(2) or 0)
    h = h % 12 + (12 if hm.group(3) == "pm" else 0) if hm.group(3) else h
    return f"{d.isoformat()} {h:02d}:{mi:02d}" if h < 24 and mi < 60 else d.isoformat()


def said(text):
    """An entry's first line without its !reminder: what a reminder says."""
    return re.sub(r"\s{2,}", " ", REMIND.sub("", (text or "").strip().split("\n")[0])).strip() or "Reminder"


def derived(db, text, day, eid=None):
    """What an entry's text decides: its tags, its reminder (ticked off again only if the reminder changes)."""
    out = {"tags": tags_of(text), "remind": remind_of(text, day)}
    if eid is not None:
        was = db.execute("SELECT remind FROM entry WHERE id = ?", (eid,)).fetchone()
        if was and was[0] != out["remind"]:
            out["reminded"] = None
    return out


def before_write(db, name, row):
    if name == "entry" and "text" in row:
        day = row.get("day")
        if not day and row.get("id"):                # an edit sends only what changed: the day is in the row
            day = (db.execute("SELECT day FROM entry WHERE id = ?", (row["id"],)).fetchone() or [None])[0]
        row.update(derived(db, row["text"], day or date.today().isoformat(), row.get("id")))
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
    return {"text": text, "tags": tags_of(text), "remind": remind_of(text, mine["day"])}


# --- adding ------------------------------------------------------------------------

def add(db, text=None, kind="work", day=None, at=None, photos=(), voice=None, log=True, videos=0):
    """One entry for a day, or, for kind 'day', more text on that day's diary.
    photos: [{image, thumb}] already shrunk in the browser; voice: {data, duration_s};
    videos: how many are about to follow (clip_in), so an entry of only videos is allowed.
    Returns the entry's id. Undo takes back everything it did."""
    day = day or date.today().isoformat()
    text = (text or "").strip() or None
    if kind not in ("day", "work"):
        raise Err(400, "kind is day or work")
    if not text and not photos and not voice and not videos:
        raise Err(400, "write something, or add a photo or a voice note")
    undo = []
    diary = db.execute("SELECT * FROM entry WHERE day = ? AND kind = 'day'", (day,)).fetchone() if kind == "day" else None
    if diary:
        eid = diary["id"]
        undo.append({"op": "restore", "table": "entry", "rows": [dict(diary)]})
        if text:
            joined = ((diary["text"] or "").rstrip() + "\n\n" + (f"{at} " if at else "") + text).strip()
            d = derived(db, joined, day, eid)
            db.execute("UPDATE entry SET text = ?, updated = ?, " + ", ".join(f"{k} = ?" for k in d) + " WHERE id = ?",
                       (joined, datetime.now().strftime("%Y-%m-%d %H:%M"), *d.values(), eid))
    else:
        eid = db.execute("INSERT INTO entry (day, at, kind, text, tags, remind) VALUES (?,?,?,?,?,?)",
                         (day, None if kind == "day" else at, kind, text, tags_of(text), remind_of(text, day))).lastrowid
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


def clip_in(db, entry_id, mime, data, duration=None):
    """A video for an entry, as it came (raw bytes, not JSON: see the server's /log/clip/). Returns its id."""
    mime = (mime or "").split(";")[0].strip().lower()
    if not mime.startswith("video/"):
        raise Err(415, "that is not a video")
    if not data:
        raise Err(400, "the video is empty")
    if len(data) > CLIP_MAX:
        raise Err(413, f"videos up to {CLIP_MAX // 2**20} MB: trim it on the phone first")
    e = db.execute("SELECT id, day FROM entry WHERE id = ?", (entry_id,)).fetchone()
    if not e:
        raise Err(404, "no such entry")
    db.execute("DELETE FROM clip_data WHERE gone IS NOT NULL AND gone < datetime('now', 'localtime', ?)", (f"-{CLIP_KEEP} days",))
    cid = db.execute("INSERT INTO clip (entry_id, mime, size, duration_s) VALUES (?,?,?,?)",
                     (e["id"], mime, len(data), round(float(duration), 1) if duration else None)).lastrowid
    db.execute("INSERT INTO clip_data (clip_id, data) VALUES (?, ?)", (cid, data))
    _db.log_change(db, "edit", "clip", f"Added a video to the entry of {e['day']}", e["id"],
                   detail={"undo": [{"op": "remove", "table": "clip", "pk": "id", "ids": [cid]}]})
    db.commit()
    return cid


def clip_out(db, cid):
    """A video to play: (its type, its size, read(start, n) for a piece of it), or None."""
    r = db.execute("SELECT c.mime, LENGTH(d.data) FROM clip c JOIN clip_data d ON d.clip_id = c.id WHERE c.id = ?",
                   (cid,)).fetchone()
    if not r:
        return None
    def read(start, n):
        if hasattr(db, "blobopen"):                  # Python 3.11: straight from the file, not the whole video
            with db.blobopen("clip_data", "data", cid, readonly=True) as b:
                b.seek(start)
                return b.read(n)
        return db.execute("SELECT substr(data, ?, ?) FROM clip_data WHERE clip_id = ?", (start + 1, n, cid)).fetchone()[0]
    return r[0], r[1], read


def share(db, fields, files):
    """A phone's share sheet: text and pictures become an entry for today. The
    pictures wait in the inbox until Log is next open, which shrinks them."""
    text = "\n".join(v.strip() for k in ("title", "text", "url") if (v := fields.get(k)) and v.strip())
    pics = [(m, d) for m, d in files if m.startswith("image/") and len(d) <= SHARE_MAX]
    if not text and not pics:
        return "/log/#/day"
    # pictures with no words, a minute after a share: the rest of it (a Shortcut sending one photo at a time)
    # ponytail: two separate shares of bare photos within a minute become one entry
    last = None if text else db.execute(
        "SELECT entity_id FROM change_log WHERE entity = 'entry' AND summary LIKE 'Shared to Log%' "
        "AND at >= datetime('now', '-1 minute') ORDER BY id DESC LIMIT 1").fetchone()
    joined = bool(last) and db.execute("SELECT 1 FROM entry WHERE id = ?", (int(last[0]),)).fetchone() is not None
    if joined:
        eid = int(last[0])
    else:
        eid = db.execute("INSERT INTO entry (day, at, kind, text, tags, remind) VALUES (?,?,?,?,?,?)",
                         (date.today().isoformat(), datetime.now().strftime("%H:%M"), "work", text or None, tags_of(text),
                          remind_of(text, date.today().isoformat()))).lastrowid
    got = [db.execute("INSERT INTO inbox (entry_id, mime, data) VALUES (?,?,?)",
                      (eid, m, f"data:{m};base64,{base64.b64encode(d).decode()}")).lastrowid for m, d in pics]
    _db.log_change(db, "edit", "entry", f"Shared to Log{f', {len(pics)} picture(s)' if pics else ''}", eid,
                   detail={"undo": [{"op": "remove", "table": "inbox", "pk": "id", "ids": got}] if joined else
                           [{"op": "remove", "table": "entry", "pk": "id", "ids": [eid]}]})
    db.commit()
    return f"/log/#/day?d={date.today().isoformat()}"


# --- what the suite asks of every app -------------------------------------------------

def calendar(db, frm, to):
    """Reminders written in entries and not yet ticked off: at their time with an alert, or all day with one at 09:00."""
    out = []
    for r in db.execute("SELECT id, text, remind FROM entry WHERE remind IS NOT NULL AND reminded IS NULL "
                        "AND substr(remind, 1, 10) BETWEEN ? AND ?", (frm, to)):
        d, _, at = r["remind"].partition(" ")
        out.append({"uid": f"remind-{r['id']}", "date": d, "title": said(r["text"]),
                    **({"at": at, "alarm": "PT0S"} if at else {"alarm": "PT9H"})})
    return out


def home(db):
    today = date.today().isoformat()
    n = db.execute("SELECT COUNT(*) FROM entry WHERE day = ? AND (kind = 'work' OR TRIM(COALESCE(text,'')) <> '')",
                   (today,)).fetchone()[0]
    due = db.execute("SELECT COUNT(*) FROM entry WHERE remind IS NOT NULL AND reminded IS NULL AND substr(remind, 1, 10) <= ?",
                     (today,)).fetchone()[0]
    recent = db.execute("SELECT id, day, at, kind, text FROM entry WHERE TRIM(COALESCE(text,'')) <> '' "
                        "ORDER BY day DESC, COALESCE(at, '99') DESC, id DESC LIMIT 3").fetchall()
    return {"figures": [{"label": "Today", "value": str(n), "sub": "entries" if n != 1 else "entry", "href": "#/day"}]
                       + ([{"label": "Reminders", "value": str(due), "sub": "to do", "href": "#/day"}] if due else []),
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
                  body.get("at") if "at" in body else now.strftime("%H:%M"), body.get("photos") or (), body.get("voice"),
                  videos=int(body.get("videos") or 0))
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

    if p == ["tag", "rename"] and method == "POST":       # #sit → #site in every entry; to a tag in use, the two become one
        old, new = (body.get("from") or "").lower().lstrip("#"), (body.get("to") or "").strip().lstrip("#")
        if not TAG.fullmatch("#" + new):
            raise Err(400, "a tag is letters, digits, - and _, starting with a letter or digit")
        hit = re.compile(rf"#{re.escape(old)}(?![\w-])", re.I)
        rows = [dict(r) for r in db.execute("SELECT id, text, tags FROM entry WHERE tags LIKE ?", (f"% {old} %",))]
        for r in rows:
            text = hit.sub("#" + new, r["text"])
            db.execute("UPDATE entry SET text = ?, tags = ? WHERE id = ?", (text, tags_of(text), r["id"]))
        # its note goes with it; onto a tag that has one, the two notes join
        notes = [dict(r) for r in db.execute("SELECT * FROM tag_note WHERE tag IN (?, ?)", (old, new.lower()))]
        mine = next((r["note"] for r in notes if r["tag"] == old), None)
        if mine and old != new.lower():
            theirs = next((r["note"] for r in notes if r["tag"] == new.lower()), None)
            db.execute("DELETE FROM tag_note WHERE tag = ?", (old,))
            db.execute("INSERT OR REPLACE INTO tag_note (tag, note) VALUES (?, ?)", (new.lower(), f"{theirs}\n{mine}" if theirs else mine))
        n = len(rows)
        _db.log_change(db, "edit", "entry", f"Renamed #{old} to #{new} in {n} entr{'y' if n == 1 else 'ies'}", rows=n,
                       detail={"undo": [{"op": "restore", "table": "entry", "rows": rows},
                                        {"op": "remove_where", "table": "tag_note", "where": {"tag": new.lower()}},
                                        {"op": "restore", "table": "tag_note", "rows": notes}]})
        db.commit()
        return 200, {"ok": True, "entries": n}

    if p[:1] == ["clip"] and len(p) == 3 and p[2] == "thumb" and method == "POST":     # a video's picture, made in the browser
        thumb = body.get("thumb")
        if thumb is not None and not str(thumb).startswith("data:image/jpeg;base64,"):
            raise Err(400, "a thumbnail is a JPEG")
        db.execute("UPDATE clip SET thumb = ? WHERE id = ?", (thumb, int(p[1])))
        db.commit()
        return 200, {"ok": True}

    if p == ["day"] and method == "GET":
        d = g("d") or date.today().isoformat()
        entries = [dict(r) for r in db.execute(
            "SELECT * FROM entry WHERE day = ? ORDER BY kind = 'work', COALESCE(at, '99:99'), id", (d,))]
        ids = [e["id"] for e in entries]
        atts = [dict(r) for r in db.execute(
            f"SELECT * FROM v_attachment WHERE entry_id IN ({','.join('?' * len(ids))}) ORDER BY id", ids)] if ids else []
        clips = [dict(r, type="video") for r in db.execute(
            f"SELECT id, entry_id, thumb, duration_s, size, created FROM clip WHERE entry_id IN ({','.join('?' * len(ids))}) "
            "ORDER BY id", ids)] if ids else []
        for e in entries:
            e["attachments"] = [a for a in atts if a["entry_id"] == e["id"]] + [c for c in clips if c["entry_id"] == e["id"]]
        near = db.execute("SELECT (SELECT MAX(day) FROM entry WHERE day < ?), (SELECT MIN(day) FROM entry WHERE day > ?)",
                          (d, d)).fetchone()
        # the day's reminders; today also those from earlier days not yet ticked off
        today = date.today().isoformat()
        rem = [dict(r, what=said(r["text"])) for r in db.execute(
            "SELECT id, day, text, remind, reminded FROM entry WHERE remind IS NOT NULL AND (substr(remind, 1, 10) = ? "
            "OR (? = ? AND reminded IS NULL AND substr(remind, 1, 10) < ?)) ORDER BY remind", (d, d, today, d))]
        return 200, {"day": d, "entries": entries, "prev": near[0], "next": near[1], "reminders": rem,
                     "tag_notes": dict(db.execute("SELECT tag, note FROM tag_note").fetchall()),   # ponytail: all of them; a handful
                     "inbox": [dict(r) for r in db.execute("SELECT i.* FROM inbox i")]}

    if p == ["photos"] and method == "GET":         # every photo and video, newest first; one tag's, if asked
        tag = (g("tag") or "").lower().lstrip("#")
        off, limit = int(g("offset", 0)), min(int(g("limit", 60)), 200)
        where, args = ("AND e.tags LIKE ?", [f"% {tag} %"]) if tag else ("", [])
        rows = [dict(r) for r in db.execute(
            "SELECT * FROM (SELECT a.id, 'photo' AS type, a.thumb, NULL AS duration_s, e.id AS entry_id, e.day, e.at, e.text "
            f"  FROM attachment a JOIN entry e ON e.id = a.entry_id WHERE a.type = 'photo' {where} "
            "UNION ALL SELECT c.id, 'video', c.thumb, c.duration_s, e.id, e.day, e.at, e.text "
            f"  FROM clip c JOIN entry e ON e.id = c.entry_id WHERE 1 {where}) "
            "ORDER BY day DESC, COALESCE(at, '99:99') DESC, id DESC LIMIT ? OFFSET ?", args + args + [limit + 1, off])]
        return 200, {"items": rows[:limit], "more": len(rows) > limit}

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
                                   "photos": r["photos"], "voices": r["voices"], "videos": r["videos"]} for r in rows]})
        note = db.execute("SELECT note FROM tag_note WHERE tag = ?", (tag,)).fetchone() if tag else None
        return 200, {"days": out, "more": len(days) == limit, "note": note[0] if note else None}

    if p == ["print"] and method == "GET":
        frm, to = g("from") or date.today().isoformat(), g("to") or g("from") or date.today().isoformat()
        entries = [dict(r) for r in db.execute(
            "SELECT * FROM entry WHERE day BETWEEN ? AND ? ORDER BY day, kind = 'work', COALESCE(at, '99:99'), id", (frm, to))]
        for e in entries:
            e["photos"] = [r[0] for r in db.execute(
                "SELECT data FROM attachment WHERE entry_id = ? AND type = 'photo' ORDER BY id", (e["id"],))]
            e["voices"] = db.execute("SELECT COUNT(*) FROM attachment WHERE entry_id = ? AND type = 'voice'",
                                     (e["id"],)).fetchone()[0]
            e["videos"] = db.execute("SELECT COUNT(*) FROM clip WHERE entry_id = ?", (e["id"],)).fetchone()[0]
        return 200, {"from": frm, "to": to, "entries": entries}
    return None
