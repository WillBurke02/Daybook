"""One runnable check for the skill map:  python3 tests/test_skilltree.py

A lesson's state follows what it needs; finishing one unlocks the next; tracks show each stop
learned, proven, fresh or fading, and a track that needs unwritten lessons is blocked; a lesson
whose final check is passed in the feed counts as learned; lessons come in 5 to 8 minute parts;
the feed brings new cards from one lesson; a refresher only from what you studied; a missed
numeric card comes back with new numbers; a rough level places you; no points, ranks or badges.
"""
import json
import os
import sys
import tempfile
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from core import db as _db, api                      # noqa: E402
from apps.learn import app as learn, skilltree       # noqa: E402

tmp = tempfile.TemporaryDirectory()
DB = os.path.join(tmp.name, "learn.db")
db = _db.open_db(DB, learn, quiet=True)
CTX = api.Ctx(True, DB, os.path.join(tmp.name, "bk"), app=learn)
R = lambda m, path, body=None, q=None: api.route(db, m, [x for x in path.split("/") if x], q or {}, body, CTX)[1]
learned = lambda lid: db.execute("INSERT INTO lesson_state (lesson_id, pos, learned) VALUES (?, 0, '2026-01-01') "
                                 "ON CONFLICT(lesson_id) DO UPDATE SET learned = excluded.learned", (lid,))

# === states: a lesson that needs another says so, and opens when that is learned ======
AC, POW = "physics.elec.ac", "electrical.supply.ac-power"
by = skilltree.lessons(db)
assert by[POW]["state"] == "needs" and AC in by[POW]["needs"], "ac-power waits on physics.elec.ac"
assert any(l["state"] == "unwritten" for l in by.values()) and any(l["state"] == "ready" for l in by.values())
assert R("GET", "lesson", q={"id": [POW]})["lesson"]["id"] == POW, "a needs lesson still opens: nothing locks"
learned(AC)
assert skilltree.lessons(db)[POW]["state"] == "ready"
assert POW in [u["id"] for u in skilltree.unlocked(db, AC)], "learning AC unlocks ac-power"

# === tracks: stops named as can-dos, blocked by unwritten ones, a track as the goal ======
db.execute("DELETE FROM lesson_state WHERE lesson_id = ?", (AC,))
ts = {t["id"]: t for t in R("GET", "tracks")["tracks"]}
assert set(ts) == {"vfd-conveyor", "plc-faults", "servo-axis", "a-level-pure", "instrument-loop", "control-panel"}
vfd = ts["vfd-conveyor"]
assert vfd["total"] == 12 and vfd["written"] + vfd["unwritten"] == 12 and vfd["unwritten"] > 0, vfd   # counts follow the content
assert vfd["stops"][0]["can"] == "Isolate and prove dead" and vfd["left"] is None and vfd["left_written"] > 0, \
    "blocked: no time estimate while lessons are unwritten"
assert vfd["next"]["written"] and vfd["next"]["state"] in ("ready", "going")
assert R("POST", "goal", {"track": "vfd-conveyor"})["goal"]["id"] == "vfd-conveyor"
plan = R("GET", "plan")
assert plan["goal"]["id"] == "vfd-conveyor" and plan["continue"]["id"] == vfd["next"]["id"], "Continue goes to the goal's next stop"
c = plan["continue"]
assert c["part"] == 1 and c["parts"] >= 2 and 4 <= c["minutes"] <= 9, c
try:
    R("POST", "goal", {"track": "no-such-track"})
    raise SystemExit("an unknown track is refused")
except api.Err:
    pass

# === parts: about 5 to 8 minutes each, never cutting an idea from its question ===========
for lid in ("drives.motors.induction", "plc.basics.ladder", "electronics.dc.ohm-kirchhoff", "maths.pure.exp-log"):
    les = R("GET", "lesson", q={"id": [lid]})
    ps, cards = les["parts"], les["cards"]
    total = les["lesson"]["minutes"] or 25
    assert ps[0]["from"] == 0 and ps[-1]["to"] == len(cards) and all(a["to"] == b["from"] for a, b in zip(ps, ps[1:])), ps
    assert all(4 <= x["minutes"] <= 9 for x in ps) and abs(sum(x["minutes"] for x in ps) - total) <= 3, (lid, ps)
    assert all(cards[x["from"] - 1]["type"] != "concept" or cards[x["from"]]["type"] == "concept" for x in ps[1:]), \
        (lid, "never cut between an idea and its question")

# === proven: the bench task done and logged; memory fades as cards are forgotten =========
ISO = "electrical.safety.isolation"
learned(ISO)
R("POST", "lesson/proven", {"lesson_id": ISO})
stop = next(x for x in R("GET", "tracks")["tracks"][0]["stops"] if x["id"] == ISO)
assert stop["state"] == "proven" and stop["proven"], stop
old = (date.today() - timedelta(days=60)).isoformat() + " 09:00"
for (cid,) in db.execute("SELECT id FROM card WHERE lesson_id = ? AND type <> 'concept' LIMIT 4", (ISO,)).fetchall():
    db.execute("INSERT INTO card_state (card_id, stability, last_review, phase, reps) VALUES (?, 3, ?, 'review', 1) "
               "ON CONFLICT(card_id) DO UPDATE SET stability = 3, last_review = excluded.last_review", (cid, old))
stop = next(x for x in R("GET", "tracks")["tracks"][0]["stops"] if x["id"] == ISO)
assert stop["fading"] and stop["memory"] < 0.85, stop
assert ISO in [x["id"] for x in R("GET", "plan")["fading"]], "a fading skill is offered for practice"
R("POST", "lesson/proven", {"lesson_id": ISO, "undo": True})
assert next(x for x in R("GET", "tracks")["tracks"][0]["stops"] if x["id"] == ISO)["state"] == "learned"
cpd = R("GET", "cpd")
assert any("Safe isolation" in t for r in cpd for t in r["learned"]), cpd[:2]

# === the feed counts: a lesson's final check passed there is learned =================
les = "plc.basics.timers-counters"
checks = [r[0] for r in db.execute("SELECT id FROM card WHERE lesson_id = ? AND stage = 'check'", (les,))]
assert checks, "the lesson has check cards"
for cid in checks[:-1]:
    assert R("POST", "answer", {"card_id": cid, "mode": "feed", "correct": True, "ms": 1000})["learned"] is None
miss = R("POST", "answer", {"card_id": checks[-1], "mode": "feed", "correct": False, "ms": 1000})
assert miss["learned"] is None and not skilltree.lessons(db)[les]["learned"]
got = R("POST", "answer", {"card_id": checks[-1], "mode": "review", "correct": True, "ms": 1000})["learned"]
assert got and got["lesson"] == les, got
assert skilltree.lessons(db)[les]["learned"], "learned through the feed and Review, never opened in the player"
assert R("POST", "answer", {"card_id": checks[0], "mode": "feed", "correct": True, "ms": 1000})["learned"] is None, "once"
cal = db.execute("SELECT id FROM card WHERE stage = 'check' AND lesson_id = 'plc.basics.scan-cycle'").fetchone()[0]
assert R("POST", "answer", {"card_id": cal, "mode": "testout", "correct": True, "ms": 1000})["learned"] is None, \
    "a placement answer is not a lesson passed"

# === no points: the answer says what comes next, and that is all =====================
a = R("POST", "answer", {"card_id": checks[0], "mode": "feed", "correct": True, "ms": 1000})
assert not ({"game", "xp", "rank", "badges"} & set(a)), sorted(a)
assert not db.execute("SELECT 1 FROM sqlite_master WHERE name = 'badge'").fetchone(), "the badge table is gone"
w = R("GET", "plan")["week"]
assert w["minutes"] >= 0 and w["days"] >= 1 and w["learned"] >= 1, w
r = R("GET", "plan")["rhythm"]
assert len(r["days"]) == 7 and r["target"] == 5 and r["sessions"] >= 0, r

# === the feed: new cards from one lesson; refreshers only from what you studied ===========
f = learn.feed(db, 30)
assert len({c["lesson_id"] for c in f if c["why"] == "new"}) <= 1, "one lesson's new cards at a time"
db.execute("DELETE FROM card_state WHERE card_id IN (SELECT id FROM card WHERE lesson_id IN (SELECT value FROM json_each("
           "(SELECT prereq FROM lesson WHERE id = 'electronics.dc.ohm-kirchhoff'))))")
ohm = db.execute("SELECT id FROM card WHERE lesson_id = 'electronics.dc.ohm-kirchhoff' AND type = 'numeric' LIMIT 1").fetchone()[0]
miss = R("POST", "answer", {"card_id": ohm, "mode": "feed", "correct": False, "mistake": {"front": "f", "back": "b"}})
assert miss["repair"] == [], "never a detour into a lesson you have not studied"
m = db.execute("SELECT type, data FROM card WHERE id = ?", (miss["mistake"],)).fetchone()
assert m[0] == "numeric" and json.loads(m[1])["from"] == ohm, "a missed numeric card comes back as itself, with new numbers"

# === first run: a rough level places you, so the feed does not start at arithmetic =========
fresh = _db.open_db(os.path.join(tmp.name, "fresh.db"), learn, quiet=True)
FR = lambda m, path, body=None, q=None: api.route(fresh, m, [x for x in path.split("/") if x], q or {}, body,
                                                  api.Ctx(True, os.path.join(tmp.name, "fresh.db"), tmp.name, app=learn))[1]
assert FR("GET", "plan")["fresh"]
FR("POST", "level/rough", {"levels": {"maths": 5}})
first = learn.feed(fresh, 5, subjects=["maths"])[0]
assert first["level"] is None or first["level"] >= 3.5, ("starts near the level you gave", first["lesson_id"], first["level"])
print("ok — skill map: states, unlocks, tracks, parts, proven, fading, feed one lesson, rough level, no points")
