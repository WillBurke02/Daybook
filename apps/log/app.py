"""Log: a diary of the day and the work day, with photos and voice notes.

An entry can carry one reminder (!fri, !tomorrow 9:00): it shows on its day and in the
calendar feed. Bills and anything else that comes round live in Money.
"""
import base64
import os
import re
import secrets
import threading
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
# a shared photo waits in inbox until Log files it, and the filed one syncs. A video's bytes do not:
# sync's files are JSON, which cannot hold raw bytes (saving a video failed with sync on)
SYNC_SKIP = ("inbox", "clip_data")

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


# --- GitHub: your activity on each day, Log as Markdown, everything encrypted (github.py) --------------

def _github_cfg(db, need_repo=False):
    from core import suite as _suite              # the token is the suite's, in suite.db: never in log.db, never synced
    st = _db.settings(db)
    user, repo, token = st.get("github_user"), st.get("github_repo"), _suite.secret("github")
    if not user or not token or (need_repo and not repo):
        raise Err(400, "set up GitHub first: Admin → GitHub" + (", with a repository to back up to" if need_repo else ""))
    return user, repo, token


def _github(db, method, p, body):
    from . import github
    from core import suite as _suite, sync as _sync
    st = _db.settings(db)
    if p == [] and method == "GET":
        return 200, {"user": st.get("github_user"), "repo": st.get("github_repo"), "token": bool(_suite.secret("github")),
                     "pulled": st.get("github_pulled"), "backed_up": st.get("github_backed_up"),
                     "events": db.execute("SELECT COUNT(*) FROM gh_event").fetchone()[0],
                     "everything": st.get("github_everything"), "running": _everything.locked(),
                     "code": _sync.code_of(_backup_key()) if st.get("github_repo") and _suite.secret("github") else None}
    if p == [] and method == "POST":
        repo = (body.get("repo") or "").strip().removeprefix("https://github.com/").strip("/")
        if repo and not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
            raise Err(400, "the repository is owner/name, such as willburke02/daybook-log")
        for k, v in (("github_user", (body.get("user") or "").strip().lstrip("@")), ("github_repo", repo)):
            db.execute("INSERT OR REPLACE INTO setting (key, value) VALUES (?, ?)", (k, v))
        if repo != st.get("github_repo"):
            db.execute("DELETE FROM setting WHERE key = 'github_sent'")      # a new repository gets every file
        db.commit()
        if "token" in body:
            _suite.keep_secret("github", (body.get("token") or "").strip())
            db.execute("INSERT OR REPLACE INTO setting (key, value) VALUES ('github_on', ?)", ("1" if (body.get("token") or "").strip() else "",))
            db.commit()
        return 200, {"ok": True}
    try:
        if p == ["pull"] and method == "POST":
            user, _, token = _github_cfg(db)
            return 200, {"added": github.pull(db, user, token)}
        if p == ["backup"] and method == "POST":
            _, repo, token = _github_cfg(db, need_repo=True)
            files = github.backup(db, token, repo)
            threading.Thread(target=back_up_everything, args=(repo, token), daemon=True).start()     # the first takes minutes
            return 200, {"files": files}
    except ValueError as e:
        raise Err(400, str(e))
    raise Err(404, "no such endpoint")


_everything = threading.Lock()


def _backup_key():
    """The key everything is encrypted with, made the first time; Admin shows it as the backup code."""
    from core import suite as _suite
    return bytes.fromhex(_suite._secret("backup", lambda: secrets.token_bytes(20).hex()))


def back_up_everything(repo, token):
    """Every database, encrypted, to the repository's daybook-backup branch (github.backup_all). How it went
    is kept in Log's settings for Admin to show. One at a time."""
    from . import github
    from core import suite as _suite
    if not _everything.acquire(blocking=False):
        return
    try:
        dbs = {"suite.db": _suite.store_path(), **{os.path.basename(p): p for p in map(_suite.path, _suite.SUITE.apps)}}
        try:
            n, size = github.backup_all(token, repo, _backup_key(), dbs, os.path.join(_suite.SUITE.data, "courses"))
            note = f"{datetime.now():%Y-%m-%d %H:%M}, {n} file(s) sent ({size / 1e6:.1f} MB)"
        except Exception as e:                    # it runs in the background: whatever went wrong shows in Admin
            note = f"failed {datetime.now():%Y-%m-%d %H:%M}: {e}"
        db = _db.connect(_suite.path("log"))
        try:
            db.execute("INSERT OR REPLACE INTO setting (key, value) VALUES ('github_everything', ?)", (note,))
            db.commit()
        finally:
            db.close()
    finally:
        _everything.release()


def daily(db):
    """Once a day on a server left running (the Pi): fetch your GitHub activity, and back Log, then everything, up there."""
    from . import github
    try:
        user, repo, token = _github_cfg(db)
    except Err:
        return
    try:
        github.pull(db, user, token)
        if repo:
            github.backup(db, token, repo)
            back_up_everything(repo, token)
    except ValueError:
        pass                                      # GitHub not reached: tomorrow, or the buttons in Admin


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


def day(db, d):
    """Home's view of a day: the diary and entries (with a photo), its reminders (today, also earlier ones
    not ticked off), and GitHub's activity."""
    out = []
    for e in db.execute("SELECT * FROM v_entry WHERE day = ? ORDER BY kind = 'work', COALESCE(at, '99:99'), id", (d,)):
        text = (e["text"] or "").strip().split("\n")[0][:160]
        if e["kind"] == "day" and not text:
            continue
        out.append({"kind": "diary" if e["kind"] == "day" else "entry", "at": e["at"], "thumb": e["thumb"],
                    "text": said(text) if REMIND.search(text) else text or ", ".join(
                        f"{n} {w}{'s' if n != 1 else ''}" for n, w in ((e["photos"], "photo"), (e["videos"], "video"), (e["voices"], "voice note")) if n),
                    "href": f"#/day?d={d}&e={e['id']}"})
    today = date.today().isoformat()
    for r in db.execute("SELECT id, day, text, remind, reminded FROM entry WHERE remind IS NOT NULL AND (substr(remind, 1, 10) = ? "
                        "OR (? = ? AND reminded IS NULL AND substr(remind, 1, 10) < ?)) ORDER BY remind", (d, d, today, d)):
        out.append({"kind": "reminder", "at": r["remind"][11:] or None, "text": said(r["text"]), "done": bool(r["reminded"]),
                    "late": r["remind"][:10] < d, "href": f"#/day?d={r['day']}&e={r['id']}",
                    "tick": {"table": "entry", "row": {"id": r["id"], "reminded": "@now"}},
                    "untick": {"table": "entry", "row": {"id": r["id"], "reminded": None}}})
    out += [{"kind": "github", "at": g["at"], "text": g["text"], "sub": g["repo"].split("/")[-1], "url": g["url"]}
            for g in db.execute("SELECT * FROM gh_event WHERE day = ? ORDER BY at", (d,))]
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
            "quick": {"placeholder": "Add to today's log", "post": "quick", "done": "Added to today"},
            "memory": _memory(db, today),
            "photos": [{"thumb": r["thumb"], "href": f"#/day?d={r['day']}&e={r['id']}"} for r in db.execute(
                "SELECT a.thumb, e.day, e.id FROM attachment a JOIN entry e ON e.id = a.entry_id WHERE a.type = 'photo' "
                "AND a.thumb IS NOT NULL ORDER BY e.day DESC, a.id DESC LIMIT 8")],
            "links": [{"label": "Today", "href": "#/day"}, {"label": "Timeline", "href": "#/timeline"}]}


def _memory(db, today):
    """On this day: the latest entry from the same day of an earlier year, if there is one."""
    r = db.execute("SELECT * FROM v_entry WHERE substr(day, 6) = ? AND day < ? AND TRIM(COALESCE(text, '')) <> '' "
                   "ORDER BY day DESC, kind = 'work', id LIMIT 1", (today[5:], today)).fetchone()
    return {"when": f"{r['day'][8:]}/{r['day'][5:7]}/{r['day'][:4]}", "year": r["day"][:4], "text": (r["text"] or "").split("\n")[0][:200],
            "thumb": r["thumb"], "href": f"#/day?d={r['day']}&e={r['id']}"} if r else None


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
        st = _db.settings(db)
        gh = [dict(r) for r in db.execute("SELECT * FROM gh_event WHERE day = ? ORDER BY at, rowid", (d,))]
        stale = st.get("github_on") == "1" and (st.get("github_pulled") or "") < (datetime.now() - timedelta(minutes=15)).strftime("%Y-%m-%d %H:%M")
        return 200, {"day": d, "entries": entries, "prev": near[0], "next": near[1], "reminders": rem,
                     "github": gh, "github_stale": stale,
                     "tag_notes": dict(db.execute("SELECT tag, note FROM tag_note").fetchall()),   # ponytail: all of them; a handful
                     "inbox": [dict(r) for r in db.execute("SELECT i.* FROM inbox i")]}

    if p[:1] == ["github"]:
        return _github(db, method, p[1:], body)

    if p[:1] == ["photos"] and method == "GET":     # every photo and video, newest first; one tag's, one kind, up to a day
        tag, kind = (g("tag") or "").lower().lstrip("#"), g("type") or ""
        where, args = "", []
        if tag:
            where, args = where + " AND e.tags LIKE ?", args + [f"% {tag} %"]
        if g("to"):                                # a month picked: from its last day back
            where, args = where + " AND e.day <= ?", args + [g("to")]
        both = ("SELECT a.id, 'photo' AS type, a.thumb, NULL AS duration_s, e.id AS entry_id, e.day, e.at, e.text "
                f"  FROM attachment a JOIN entry e ON e.id = a.entry_id WHERE a.type = 'photo' {where} AND ? IN ('', 'photo') "
                "UNION ALL SELECT c.id, 'video', c.thumb, c.duration_s, e.id, e.day, e.at, e.text "
                f"  FROM clip c JOIN entry e ON e.id = c.entry_id WHERE 1 {where} AND ? IN ('', 'video')")
        args = args + [kind] + args + [kind]
        if p == ["photos", "months"]:              # how many in each month, for jumping about
            return 200, {"months": [dict(r) for r in db.execute(
                f"SELECT substr(day, 1, 7) AS month, COUNT(*) AS n FROM ({both}) GROUP BY month ORDER BY month DESC", args)]}
        off, limit = int(g("offset", 0)), min(int(g("limit", 60)), 200)
        rows = [dict(r) for r in db.execute(
            f"SELECT * FROM ({both}) ORDER BY day DESC, COALESCE(at, '99:99') DESC, id DESC LIMIT ? OFFSET ?", args + [limit + 1, off])]
        return 200, {"items": rows[:limit], "more": len(rows) > limit}

    if p == ["timeline"] and method == "GET":
        before, tag = g("before", "9999-12-31"), (g("tag") or "").lower().lstrip("#")
        limit = min(int(g("limit", 30)), 200)
        # only some entries: a tag, work or diary, those with photos or videos
        only, oargs = "", []
        if tag:
            only, oargs = only + " AND tags LIKE ?", oargs + [f"% {tag} %"]
        if g("kind") in ("work", "day"):
            only, oargs = only + " AND kind = ?", oargs + [g("kind")]
        if g("media"):
            only += (" AND (id IN (SELECT entry_id FROM attachment WHERE type = 'photo')"
                     " OR id IN (SELECT entry_id FROM clip))")
        days = [r[0] for r in db.execute(f"SELECT DISTINCT day FROM entry WHERE day < ? {only} ORDER BY day DESC LIMIT ?",
                                         [before] + oargs + [limit])]
        out = []
        for d in days:
            rows = db.execute(f"SELECT * FROM v_entry WHERE day = ? {only} "
                              "ORDER BY kind = 'work', COALESCE(at, '99:99'), id", [d] + oargs).fetchall()
            thumbs = [r[0] for r in db.execute(
                "SELECT a.thumb FROM attachment a JOIN entry e ON e.id = a.entry_id WHERE e.day = ? AND a.thumb IS NOT NULL "
                "ORDER BY a.id LIMIT 6", (d,))]
            out.append({"day": d, "thumbs": thumbs,
                        "lines": [{"at": r["at"], "kind": r["kind"], "text": (r["text"] or "").strip()[:600],   # the page shows 4 lines
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
