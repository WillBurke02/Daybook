"""One runnable check for the skill tree:  python3 tests/test_skilltree.py

XP and rank maths; a lesson's state follows what it needs; finishing one unlocks the next;
a goal's route puts every prerequisite before what needs it and clears itself when reached;
badges are earned once; placement answers earn no XP.
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from core import db as _db, api                      # noqa: E402
from apps.learn import app as learn, gamify          # noqa: E402

tmp = tempfile.TemporaryDirectory()
DB = os.path.join(tmp.name, "learn.db")
db = _db.open_db(DB, learn, quiet=True)
CTX = api.Ctx(True, DB, os.path.join(tmp.name, "bk"), app=learn)
R = lambda m, path, body=None, q=None: api.route(db, m, [x for x in path.split("/") if x], q or {}, body, CTX)[1]
learned = lambda lid: db.execute("INSERT INTO lesson_state (lesson_id, pos, learned) VALUES (?, 0, '2026-01-01') "
                                 "ON CONFLICT(lesson_id) DO UPDATE SET learned = excluded.learned", (lid,))

# === rank: 50·n·(n−1) XP reaches rank n ===========================================
assert [gamify.rank(x)["rank"] for x in (0, 99, 100, 299, 300, 999, 1000, 4500)] == [1, 1, 2, 2, 3, 4, 5, 10]
r = gamify.rank(612)
assert (r["rank"], r["from"], r["to"]) == (4, 600, 1000), r

# === states: a lesson that needs another says so, and opens when that is learned ======
AC, POW = "physics.elec.ac", "electrical.supply.ac-power"
by = gamify.lessons(db)
assert by[POW]["state"] == "needs" and AC in by[POW]["needs"], "ac-power waits on physics.elec.ac"
assert by["electrical.supply.three-phase"]["state"] in ("needs", "unwritten")
assert any(l["state"] == "unwritten" for l in by.values()) and any(l["state"] == "ready" for l in by.values())
assert R("GET", "lesson", q={"id": [POW]})["lesson"]["id"] == POW, "a needs lesson still opens: nothing locks"
learned(AC)
assert gamify.lessons(db)[POW]["state"] == "ready"
assert POW in [u["id"] for u in gamify.unlocked(db, AC)], "learning AC unlocks ac-power"
t = R("GET", "tree", q={"subject": ["electrical"]})
n = {l["id"]: l for l in t["lessons"]}[POW]
assert n["state"] == "ready" and [x["id"] for x in n["needs"]] == [AC] and n["step"] is None

# === a goal: the route puts prerequisites first, and clears itself when learned ======
db.execute("DELETE FROM lesson_state WHERE lesson_id = ?", (AC,))
by = gamify.lessons(db)
goal = max((i for i, l in by.items() if l["cards"]), key=lambda i: len(gamify.route(by, i)))
assert len(gamify.route(by, goal)) >= 3, "the outline has a chain of three"
rm = R("POST", "goal", {"lesson_id": goal})["roadmap"]
ids = [s["id"] for s in rm["steps"]]
assert ids[-1] == goal and len(ids) >= 2, ids
pos = {i: k for k, i in enumerate(ids)}
for i in ids:
    for p in by[i]["pre"]:
        assert p not in pos or pos[p] < pos[i], f"{p} comes before {i}"
assert rm["done"] == 0 and rm["next"]["id"] == ids[0] and rm["total"] == len(ids)
learned(ids[0])
assert R("GET", "game")["roadmap"]["done"] == 1
for i in ids:
    learned(i)
out = gamify.after_learn(db, goal, 0)
assert out["goal_reached"] and "goal" in [b["id"] for b in out["badges"]]
assert gamify.roadmap(db) is None, "reaching the goal clears it"
try:
    R("POST", "goal", {"lesson_id": "no.such.lesson"})
    raise SystemExit("an unknown goal is refused")
except api.Err:
    pass

# === XP: right 10, wrong 2, placement 0; badges once ===================================
card = db.execute("SELECT id FROM card WHERE source = 'file' AND type = 'mcq' AND COALESCE(stage, '') <> 'calibrate' LIMIT 1").fetchone()[0]
base = gamify.xp(db)
a = R("POST", "answer", {"card_id": card, "mode": "lesson", "correct": True, "ms": 1000})
assert a["game"]["gain"] == 10 and gamify.xp(db) == base + 10
assert "first-card" in [b["id"] for b in a["game"]["badges"]]
b = R("POST", "answer", {"card_id": card, "mode": "feed", "correct": False, "ms": 1000})
assert b["game"]["gain"] == 2 and not b["game"]["badges"], "a badge is announced once"
c = R("POST", "answer", {"card_id": card, "mode": "calibrate", "correct": True, "ms": 1000})
assert c["game"]["gain"] == 0, "placement answers earn nothing"
g = R("GET", "game")
assert {b["id"] for b in g["badges"] if b["at"]} >= {"first-card", "goal"} and len(g["badges"]) >= 15
assert [q["id"] for q in g["quests"]] == ["due", "learn", "fix"]
print("ok — skill tree: rank, states, unlocks, routes, XP, badges")
