"""One runnable check for Log:  python3 tests/test_log.py

Entries and the diary, tags, photos and voice notes (and what the database
refuses), undo, the day, the timeline, printing, search, the phone's share sheet
and its inbox, and the Home card.
"""
import base64
import os
import sqlite3
import sys
import tempfile
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from core import db as _db, api                      # noqa: E402
from apps.log import app as log                     # noqa: E402

tmp = tempfile.TemporaryDirectory()
DB = os.path.join(tmp.name, "log.db")
db = _db.open_db(DB, log, quiet=True)
CTX = api.Ctx(True, DB, os.path.join(tmp.name, "bk"), app=log)
R = lambda m, path, body=None, q=None: api.route(db, m, [x for x in path.split("/") if x], q or {}, body, CTX)[1]
one = lambda sql, *a: db.execute(sql, a).fetchone()
JPEG = "data:image/jpeg;base64,/9j/4AAQ"
WEBM = "data:audio/webm;base64,GkXfo59"


def refused(fn, what):
    try:
        fn()
    except (sqlite3.IntegrityError, api.Err):
        db.rollback()
        return
    raise SystemExit(f"FAIL: accepted {what}")


# === tags are the #words typed, padded so one never matches part of another ======
assert log.tags_of("Swapped the PLC #site #TS247, then #site again") == " site ts247 "
assert log.tags_of("no tags, and C# is not one") is None and log.tags_of("") is None
assert log.tags_of("#a-b_c #x") == " a-b_c x "

# === entries: work ones in time order, one diary a day ===========================
D = "2026-09-03"
e1 = R("POST", "quick", {"text": "Swapped the PLC #site #TS247", "day": D, "at": "09:15",
                         "photos": [{"image": JPEG, "thumb": JPEG}], "voice": {"data": WEBM, "duration_s": 12.3}})["id"]
e2 = R("POST", "quick", {"text": "Commissioned the drive #site", "day": D, "at": "07:40"})["id"]
R("POST", "quick", {"text": "A long one.", "kind": "day", "day": D, "at": "18:00"})
R("POST", "quick", {"text": "Tea with Sam.", "kind": "day", "day": D, "at": "20:00"})
assert one("SELECT COUNT(*) n FROM entry WHERE day=? AND kind='day'", D)["n"] == 1, "one diary a day: more text joins it"
diary = one("SELECT * FROM entry WHERE day=? AND kind='day'", D)
assert diary["text"] == "A long one.\n\n20:00 Tea with Sam.", repr(diary["text"])
refused(lambda: db.execute("INSERT INTO entry (day, kind, text) VALUES (?, 'day', 'x')", (D,)), "a second diary")
day = R("GET", "day", q={"d": [D]})
assert [e["kind"] for e in day["entries"]] == ["day", "work", "work"]
assert [e["at"] for e in day["entries"] if e["kind"] == "work"] == ["07:40", "09:15"], "work in time order"
first = next(e for e in day["entries"] if e["id"] == e1)
assert [a["type"] for a in first["attachments"]] == ["photo", "voice"] and "data" not in first["attachments"][0]
assert first["attachments"][1]["duration_s"] == 12.3
expect_empty = lambda: R("POST", "quick", {"text": "  ", "day": D})
refused(expect_empty, "an empty entry")

# editing through the generic API keeps the tags in step with the text
R("POST", "t/entry", {"id": e2, "text": "Commissioned the drive #siemens"})
assert one("SELECT tags, updated FROM entry WHERE id=?", e2)["tags"] == " siemens " and one("SELECT updated FROM entry WHERE id=?", e2)[0]

# === what the database refuses ======================================================
refused(lambda: db.execute("INSERT INTO attachment (entry_id, type, data) VALUES (?, 'photo', 'data:image/svg+xml;base64,PHN2Zz4=')", (e1,)), "an SVG")
refused(lambda: db.execute("INSERT INTO attachment (entry_id, type, data) VALUES (?, 'photo', 'data:text/html;base64,PGI+')", (e1,)), "HTML")
refused(lambda: db.execute("INSERT INTO attachment (entry_id, type, data, duration_s) VALUES (?, 'voice', ?, 601)", (e1, WEBM)), "11 minutes of voice")
refused(lambda: db.execute("INSERT INTO attachment (entry_id, type, data, duration_s) VALUES (?, 'voice', 'data:audio/wav;base64,UklG', 3)", (e1,)), "WAV")
refused(lambda: db.execute("INSERT INTO entry (day, text) VALUES ('3 Sep', 'x')"), "a date not ISO")
refused(lambda: db.execute("INSERT INTO entry (day, at, text) VALUES (?, '9:15', 'x')", (D,)), "a time not HH:MM")
# an iPhone records mp4, Firefox ogg: both are voice notes too
for d_ in ("data:audio/mp4;base64,AAAA", "data:audio/ogg;base64,T2dn"):
    db.execute("INSERT INTO attachment (entry_id, type, data, duration_s) VALUES (?, 'voice', ?, 2)", (e1, d_))
db.rollback()

# === undo ==========================================================================
R("DELETE", f"t/entry/{e1}")
assert one("SELECT COUNT(*) n FROM attachment WHERE entry_id=?", e1)["n"] == 0, "the photo goes with its entry"
R("POST", "undo")
assert one("SELECT COUNT(*) n FROM attachment WHERE entry_id=?", e1)["n"] == 2, "and comes back with it"
n = one("SELECT COUNT(*) n FROM entry")["n"]
R("POST", "quick", {"text": "oops", "day": D})
R("POST", "undo")
assert one("SELECT COUNT(*) n FROM entry")["n"] == n, "an add can be undone"
R("POST", "quick", {"text": "more", "kind": "day", "day": D})
R("POST", "undo")
assert one("SELECT text FROM entry WHERE day=? AND kind='day'", D)["text"] == "A long one.\n\n20:00 Tea with Sam."
R("POST", f"attach/{e2}", {"photos": [{"image": JPEG, "thumb": JPEG}]})
assert one("SELECT COUNT(*) n FROM attachment WHERE entry_id=?", e2)["n"] == 1
R("POST", "undo")
assert one("SELECT COUNT(*) n FROM attachment WHERE entry_id=?", e2)["n"] == 0
print("ok — entries, diary, tags, media, undo")

# === looking back: timeline, calendar, tags, printing, search ==========================
R("POST", "quick", {"text": "Site survey #site", "day": "2026-09-10", "at": "10:00"})
R("POST", "quick", {"text": "Drawings", "day": "2026-08-28", "at": "10:00"})
tl = R("GET", "timeline", q={"limit": ["2"]})
assert [d["day"] for d in tl["days"]] == ["2026-09-10", D] and tl["more"]
assert tl["days"][1]["lines"][0]["kind"] == "day" and len(tl["days"][1]["thumbs"]) == 1
older = R("GET", "timeline", q={"before": [D]})
assert [d["day"] for d in older["days"]] == ["2026-08-28"] and not older["more"]
tagged = R("GET", "timeline", q={"tag": ["#site"]})
assert [d["day"] for d in tagged["days"]] == ["2026-09-10", D]
assert all("#site" in l["text"] for d in tagged["days"] for l in d["lines"])
assert not R("GET", "timeline", q={"tag": ["sit"]})["days"], "part of a tag is not the tag"
tags = {r["tag"]: r["n"] for r in R("GET", "v/v_tag")}
assert tags == {"site": 2, "ts247": 1, "siemens": 1}, tags
days = {r["day"]: r for r in R("GET", "v/v_log_day")}
assert days[D]["work"] == 2 and days[D]["diary"] == 1 and days[D]["attachments"] == 2
pr = R("GET", "print", q={"from": ["2026-09-01"], "to": ["2026-09-30"]})
assert [e["day"] for e in pr["entries"]] == [D, D, D, "2026-09-10"] and pr["entries"][2]["photos"] == [JPEG]
assert pr["entries"][2]["voices"] == 1
found = {g["kind"]: g["rows"] for g in R("GET", "search", q={"q": ["plc site"]})}
assert found["entry"][0]["text"].startswith("Swapped") and found["entry"][0]["thumb"] == JPEG
assert R("GET", "search", q={"q": ["siemens"]})[0]["rows"][0]["id"] == e2, "tags are searched"
# renaming a tag rewrites it in every entry (any case, never part of a longer tag); renaming onto one in use merges them
db.execute("INSERT INTO entry (day, kind, text, tags) VALUES ('2026-09-11', 'work', 'At #SITE and #site-b', ?)", (log.tags_of("At #SITE and #site-b"),))
R("POST", "t/tag_note", {"tag": "site", "note": "The Leeds plant"})
R("POST", "t/tag_note", {"tag": "ts247", "note": "S7-1500 on line 2"})
assert {r["tag"]: r["note"] for r in R("GET", "v/v_tag")}["site"] == "The Leeds plant"
refused(lambda: R("POST", "t/tag_note", {"tag": "Site", "note": "x"}), "a tag note under a capital")
assert R("POST", "tag/rename", {"from": "#site", "to": "Plant"})["entries"] == 3
assert one("SELECT note FROM tag_note WHERE tag = 'plant'")[0] == "The Leeds plant", "the note goes with the tag"
tags = {r["tag"]: r["n"] for r in R("GET", "v/v_tag")}
assert tags == {"plant": 3, "site-b": 1, "ts247": 1, "siemens": 1}, tags
assert one("SELECT text FROM entry WHERE day = '2026-09-11'")[0] == "At #Plant and #site-b"
assert R("POST", "tag/rename", {"from": "ts247", "to": "plant"})["entries"] == 1, "onto a tag in use: merged"
tags = {r["tag"]: r["n"] for r in R("GET", "v/v_tag")}
assert tags == {"plant": 3, "site-b": 1, "siemens": 1}, tags          # the #ts247 entry was #site too
assert one("SELECT note FROM tag_note WHERE tag = 'plant'")[0] == "The Leeds plant\nS7-1500 on line 2", "merged: both notes"
refused(lambda: R("POST", "tag/rename", {"from": "plant", "to": "two words"}), "a tag with a space")
R("POST", "undo", {}); R("POST", "undo", {})
assert {r["tag"]: r["n"] for r in R("GET", "v/v_tag")} == {"site": 3, "site-b": 1, "ts247": 1, "siemens": 1}, "undo puts both back"
assert dict(db.execute("SELECT tag, note FROM tag_note").fetchall()) == {"site": "The Leeds plant", "ts247": "S7-1500 on line 2"}, "and the notes"
assert R("GET", "timeline", q={"tag": ["site"]})["note"] == "The Leeds plant"
assert one("SELECT text FROM entry WHERE day = '2026-09-11'")[0] == "At #SITE and #site-b"
db.execute("DELETE FROM entry WHERE day = '2026-09-11'"); db.commit()
ph = R("GET", "photos")
assert ph["items"] and all(i["type"] in ("photo", "video") and i["day"] for i in ph["items"]) and "data" not in ph["items"][0]
assert all("#site" in (i["text"] or "").lower() for i in R("GET", "photos", q={"tag": ["site"]})["items"])
assert not R("GET", "photos", q={"tag": ["siemens"]})["items"], "a tag with no photos has none"
assert all(i["type"] == "photo" for i in R("GET", "photos", q={"type": ["photo"]})["items"]) and not R("GET", "photos", q={"type": ["video"]})["items"]
mo = R("GET", "photos/months")["months"]
assert sum(m["n"] for m in mo) == len(ph["items"]) and all(i["day"] <= "2026-09-10" for i in R("GET", "photos", q={"to": ["2026-09-10"]})["items"])
assert all(l["kind"] == "day" for d in R("GET", "timeline", q={"kind": ["day"]})["days"] for l in d["lines"])
assert all(l["photos"] or l["videos"] for d in R("GET", "timeline", q={"media": ["1"]})["days"] for l in d["lines"])   # only entries with media
print("ok — timeline, calendar, tags, rename, print, search")

# === reminders: !fri in an entry, from the entry's own day =========================================
assert log.remind_of("Order bearings !fri 9am", "2026-10-14") == "2026-10-16 09:00"
assert log.remind_of("!16/10", "2026-10-20") == "2027-10-16" and log.remind_of("Done! fri", "2026-10-14") is None
T = date.today().isoformat()
rid = log.add(db, "Check the pump seal on M3 !today 07:30 #site", day=T)
assert one("SELECT remind, reminded FROM entry WHERE id = ?", rid)[:] == (f"{T} 07:30", None)
rem = R("GET", "day", q={"d": [T]})["reminders"]
assert [(r["id"], r["what"]) for r in rem] == [(rid, "Check the pump seal on M3 #site")], rem
ev = [e for e in log.calendar(db, T, T) if e["uid"] == f"remind-{rid}"]
assert ev == [{"uid": f"remind-{rid}", "date": T, "title": "Check the pump seal on M3 #site", "at": "07:30", "alarm": "PT0S"}], ev
assert any(f["label"] == "Reminders" for f in log.home(db)["figures"])
R("POST", "t/entry", {"id": rid, "reminded": f"{T} 08:00"})                       # ticked off: out of the feed
assert not [e for e in log.calendar(db, T, T) if e["uid"] == f"remind-{rid}"]
R("POST", "t/entry", {"id": rid, "text": "Check the pump seal on M3 !tomorrow"})   # a new when: to do again
r = one("SELECT remind, reminded FROM entry WHERE id = ?", rid)
assert r["remind"] == (date.fromisoformat(T) + __import__("datetime").timedelta(days=1)).isoformat() and r["reminded"] is None
db.execute("DELETE FROM entry WHERE id = ?", (rid,)); db.commit()
print("ok — reminders")

# === GitHub: activity on each day, and Log as Markdown in a repository (a fake GitHub here) ========
from apps.log import github as gh                        # noqa: E402
EV = [{"id": "1", "type": "PushEvent", "created_at": "2026-10-14T09:40:00Z", "repo": {"name": "me/daybook"},
       "payload": {"ref": "refs/heads/main", "commits": [{"sha": "abc", "message": "Fix the menu\n\nlonger", "distinct": True},
                                                       {"sha": "def", "message": "Merge", "distinct": False}]}},
      {"id": "2", "type": "PushEvent", "created_at": "2026-10-14T10:00:00Z", "repo": {"name": "me/daybook"},
       "payload": {"ref": "refs/heads/main", "size": 3, "head": "f00"}},
      {"id": "3", "type": "PullRequestEvent", "created_at": "2026-10-14T11:00:00Z", "repo": {"name": "me/daybook"},
       "payload": {"action": "closed", "pull_request": {"number": 7, "title": "Reminders", "merged": True, "html_url": "u7"}}},
      {"id": "4", "type": "WatchEvent", "created_at": "2026-10-14T12:00:00Z", "repo": {"name": "x/y"}, "payload": {}}]
got = [r for ev in EV for r in gh.rows_of(ev)]
assert [(r[0], r[4], r[5]) for r in got] == [("abc", "commit", "Fix the menu"), ("2", "commit", "Pushed 3 commits to main"),
                                             ("3", "pr", "Merged pull request #7: Reminders")], got
puts, remote = [], {}
def fake(token, method, path, body=None):
    assert token == "t0k"
    if path.startswith("/users/me/events"):
        return EV if "page=1" in path else []
    if method == "GET":
        return {"sha": remote[path.split("/contents/")[1].split("?")[0]]} if path.split("/contents/")[1].split("?")[0] in remote else None
    name = path.split("/contents/")[1]
    if name in remote and body.get("sha") != remote[name]:
        raise ValueError("GitHub said 409 Conflict")
    remote[name] = f"sha-{len(puts)}"
    puts.append((name, base64.b64decode(body["content"]).decode()))
    return {"content": {"sha": remote[name]}}
gh._gh = fake
assert gh.pull(db, "me", "t0k") == 3 and gh.pull(db, "me", "t0k") == 0, "each kept once"
day = R("GET", "day", q={"d": ["2026-10-14"]})
assert [g["text"] for g in day["github"]][0] == "Fix the menu" and len(day["github"]) == 3
md = gh.month_md(db, "2026-09")
assert md.startswith("# Log, September 2026\n\n## ") and "**Diary.**" in md and "\n- **" in md, md[:300]
n = gh.backup(db, "t0k", "me/log")
assert n == len(puts) and "log/tags.md" in remote and any(k.startswith("log/2026/2026-09") for k in remote), remote
assert gh.backup(db, "t0k", "me/log") == 0, "nothing changed: nothing sent"
remote["log/tags.md"] = "edited-on-github"                 # changed there since: asked for its sha, sent again
db.execute("INSERT INTO entry (day, kind, text, tags) VALUES ('2026-09-02', 'work', 'More #site', ' site ')"); db.commit()
assert gh.backup(db, "t0k", "me/log") == 2 and "More #site" in puts[-2][1] + puts[-1][1]
db.execute("DELETE FROM entry WHERE day = '2026-09-02' AND text = 'More #site'"); db.execute("DELETE FROM gh_event"); db.commit()
print("ok — GitHub activity and Markdown backup")

# === the phone's share sheet ===========================================================
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64
where = log.share(db, {"title": "From the gallery", "text": "Panel #site"}, [("image/png", PNG), ("text/plain", b"x")])
assert where == f"/log/#/day?d={date.today().isoformat()}"
sh = one("SELECT * FROM entry ORDER BY id DESC LIMIT 1")
assert sh["text"] == "From the gallery\nPanel #site" and sh["tags"] == " site " and sh["day"] == date.today().isoformat()
inbox = R("GET", "t/inbox")
assert len(inbox) == 1 and inbox[0]["data"].startswith("data:image/png;base64,") and inbox[0]["entry_id"] == sh["id"]
assert R("GET", "day")["inbox"] == 1, "the day says how many wait, not the pictures themselves"
# the browser shrinks it and files it; the inbox row goes
R("POST", f"attach/{sh['id']}", {"photos": [{"image": JPEG, "thumb": JPEG}], "inbox": [inbox[0]["id"]]})
assert not R("GET", "t/inbox") and one("SELECT COUNT(*) n FROM attachment WHERE entry_id=?", sh["id"])["n"] == 1
assert log.share(db, {}, []) == "/log/#/day", "nothing shared, nothing added"
refused(lambda: db.execute("INSERT INTO inbox (entry_id, mime, data) VALUES (?, 'text/html', 'data:text/html;base64,x')", (sh["id"],)), "HTML in the inbox")

# === videos ===========================================================================
# raw bytes, up to 60 MB, played back in pieces; an entry of only videos is allowed; deleting the entry and
# undoing it brings the video back (its bytes wait, outside the change history, for 30 days)
vid = R("POST", "quick", {"text": "", "videos": 1})["id"]
cid = log.clip_in(db, vid, "video/mp4; codecs=avc1", b"\x00\x00\x00\x18ftypmp42" + bytes(range(256)) * 40, "12.34")
mime, size, read = log.clip_out(db, cid)
assert mime == "video/mp4" and size == 12 + 256 * 40 and read(4, 4) == b"ftyp" and read(12 + 255, 2) == bytes([255, 0])
d = R("GET", "day", q={"d": [date.today().isoformat()]})
v = [a for e in d["entries"] if e["id"] == vid for a in e["attachments"]]
assert v and v[0]["type"] == "video" and v[0]["duration_s"] == 12.3 and "data" not in v[0], v
R("POST", f"clip/{cid}/thumb", {"thumb": JPEG})
assert one("SELECT thumb FROM clip WHERE id = ?", cid)["thumb"] == JPEG
refused(lambda: log.clip_in(db, vid, "text/html", b"<x>"), "not a video")
refused(lambda: log.clip_in(db, vid, "video/mp4", b"x" * (log.CLIP_MAX + 1)), "a video over the limit")
refused(lambda: log.clip_in(db, 999999, "video/mp4", b"x"), "a video for no entry")
R("DELETE", f"t/entry/{vid}")
assert not log.clip_out(db, cid) and one("SELECT gone FROM clip_data WHERE clip_id = ?", cid)["gone"], "gone, but kept"
assert "ftyp" not in one("SELECT detail FROM change_log ORDER BY id DESC LIMIT 1")["detail"], "no video in the change history"
R("POST", "undo", {})
assert log.clip_out(db, cid)[1] == size and one("SELECT gone FROM clip_data WHERE clip_id = ?", cid)["gone"] is None, "undo: it plays again"
assert R("GET", "v/v_entry", q={"id": [str(vid)]})[0]["videos"] == 1
db.execute("UPDATE clip_data SET gone = '2000-01-01 00:00' WHERE clip_id = ?", (cid,))
db.execute("DELETE FROM clip WHERE id = ?", (cid,))
db.execute("UPDATE clip_data SET gone = '2000-01-01 00:00' WHERE clip_id = ?", (cid,))
log.clip_in(db, vid, "video/mp4", b"x")                      # the next one in clears the long-gone
assert not one("SELECT 1 FROM clip_data WHERE clip_id = ?", cid), "a video gone 30 days is cleared"
print("ok — videos: raw, in pieces, only videos, delete and undo, the limit")

# === everything, encrypted, on a branch of its own (a fake of GitHub's git database here) ===========
git = {"blobs": {}, "trees": {}, "commits": {}, "refs": {}}
def gitfake(token, method, path, body=None, timeout=30):
    p = path.split("/repos/me/log/git/", 1)[1]
    if method == "POST" and p in ("blobs", "trees", "commits"):
        sha = f"{p}{len(git[p])}"
        git[p][sha] = body
        return {"sha": sha}
    if method == "GET" and p.startswith("blobs/"):
        return git["blobs"][p[6:]]
    if method == "GET" and p.startswith("trees/"):
        ref = git["refs"].get(p[6:].split("?")[0])
        return {"tree": [dict(x) for x in git["trees"][git["commits"][ref]["tree"]]["tree"]]} if ref else None
    if method == "PATCH" and p.startswith("refs/heads/"):
        if p[11:] not in git["refs"]:
            raise ValueError("GitHub said 422 Unprocessable Entity")
        git["refs"][p[11:]] = body["sha"]
        return {}
    if method == "POST" and p == "refs":
        git["refs"][body["ref"][11:]] = body["sha"]
        return {}
    raise AssertionError(path)
gh._gh = gitfake
db.commit()
db.execute("INSERT INTO attachment (entry_id, type, data) VALUES (?, 'voice', ?)", (sh["id"], WEBM)); db.commit()
KEY, courses = bytes(range(20)), os.path.join(tmp.name, "courses")
os.makedirs(os.path.join(courses, "deck"))
open(os.path.join(courses, "deck", "course.json"), "w").write('{"title": "Mine"}')
media = one("SELECT (SELECT COUNT(DISTINCT data) FROM attachment) + (SELECT COUNT(*) FROM clip_data) n")["n"]
assert gh.backup_all("t0k", "me/log", KEY, {"log.db": DB}, courses)[0] == media + 2, "each photo, voice note and video, the database, the courses"
sealed = b"".join(base64.b64decode(b["content"]) for b in git["blobs"].values())
assert b"gallery" not in sealed and b"/9j/4AAQ" not in sealed and b"Mine" not in sealed, "nothing readable on GitHub"
assert gh.backup_all("t0k", "me/log", KEY, {"log.db": DB}, courses)[0] == 2, "the next day: the media are there already"
assert len(git["commits"]) == 2 and not git["commits"]["commits1"]["parents"], "one commit on the branch, replaced"
back = os.path.join(tmp.name, "back")
os.makedirs(back)
gh.restore_all("t0k", "me/log", KEY, back)
rb = sqlite3.connect(os.path.join(back, "log.db"))
for sql in ("SELECT id, data FROM attachment ORDER BY id", "SELECT clip_id, data, gone FROM clip_data ORDER BY clip_id",
            "SELECT id, text FROM entry ORDER BY id"):
    assert rb.execute(sql).fetchall() == [tuple(r) for r in db.execute(sql)], sql
assert not rb.execute("SELECT 1 FROM sqlite_master WHERE name = 'backup_media'").fetchone() and rb.execute("PRAGMA quick_check").fetchone()[0] == "ok"
rb.close()
assert open(os.path.join(back, "courses", "deck", "course.json")).read() == '{"title": "Mine"}'
try:
    gh.restore_all("t0k", "me/log", bytes(20), tempfile.mkdtemp())
    raise SystemExit("FAIL: opened with the wrong code")
except ValueError as e:
    assert "does not open" in str(e)
print("ok — everything encrypted on GitHub: media once each, one commit, restored the same")

# === Home =============================================================================
R("POST", "quick", {"text": "Today's first", "at": "08:00"})
h = R("GET", "home")
assert h["figures"][0]["label"] == "Today" and int(h["figures"][0]["value"]) >= 2 and h["quick"]["post"] == "quick"
assert h["items"][0]["text"] and len(h["items"]) == 3
print("ok — share sheet, inbox, Home")

db.close()
tmp.cleanup()
print("\nok — all Log checks passed")
