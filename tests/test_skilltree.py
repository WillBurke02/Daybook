"""One runnable check for the skill tree:  python3 tests/test_skilltree.py

A lesson's state follows what it needs; finishing one unlocks the next; a goal's route puts
every prerequisite before what needs it and clears itself when reached; a lesson whose final
check is passed in the feed counts as learned, as in the player; no points, ranks or badges.
"""
import os
import sys
import tempfile

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
n = {l["id"]: l for l in R("GET", "tree", q={"subject": ["electrical"]})["lessons"]}[POW]
assert n["state"] == "ready" and [x["id"] for x in n["needs"]] == [AC] and n["step"] is None

# === a goal: the route puts prerequisites first, and clears itself when learned ======
db.execute("DELETE FROM lesson_state WHERE lesson_id = ?", (AC,))
by = skilltree.lessons(db)
goal = max((i for i, l in by.items() if l["cards"]), key=lambda i: len(skilltree.route(by, i)))
assert len(skilltree.route(by, goal)) >= 3, "the outline has a chain of three"
rm = R("POST", "goal", {"lesson_id": goal})["roadmap"]
ids = [s["id"] for s in rm["steps"]]
assert ids[-1] == goal and len(ids) >= 2, ids
pos = {i: k for k, i in enumerate(ids)}
for i in ids:
    for p in by[i]["pre"]:
        assert p not in pos or pos[p] < pos[i], f"{p} comes before {i}"
assert rm["done"] == 0 and rm["next"]["id"] == ids[0] and rm["total"] == len(ids)
learned(ids[0])
assert R("GET", "plan")["roadmap"]["done"] == 1
for i in ids[:-1]:
    learned(i)
out = learn.mark_learned(db, goal)
assert out["goal_reached"] and out["title"], out
assert skilltree.roadmap(db) is None, "reaching the goal clears it"
try:
    R("POST", "goal", {"lesson_id": "no.such.lesson"})
    raise SystemExit("an unknown goal is refused")
except api.Err:
    pass

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
print("ok — skill tree: states, unlocks, routes, feed lessons count, no points")
