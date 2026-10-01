"""The game layer: XP and rank, badges, the skill tree's lesson states, and the route to a goal.

Everything is worked out from the answer log and lesson state, so it cannot drift from the
real record. Only the badges you have been shown and your goal (a setting) are stored.
Nothing here ever locks a lesson: "needs" is a hint (PLAN-SKILLTREE.md).
"""
import json
import math
from datetime import date

RIGHT, TRIED, LEARNED = 10, 2, 50        # XP: a right answer, a wrong one, a lesson learned
NOT_COUNTED = ("calibrate", "testout")   # placement tests earn no XP, so they cannot be farmed


def rank_floor(n):
    """XP needed to reach rank n: 50·n·(n−1), so rank 2 at 100, 5 at 1000, 10 at 4500."""
    return 50 * n * (n - 1)


def rank(xp):
    n = max(1, int((1 + math.sqrt(1 + 4 * xp / 50)) / 2))
    while rank_floor(n + 1) <= xp:
        n += 1
    while n > 1 and rank_floor(n) > xp:
        n -= 1
    return {"xp": xp, "rank": n, "from": rank_floor(n), "to": rank_floor(n + 1)}


def xp(db, subject=None):
    sub = " AND subject_id = ?" if subject else ""
    a = db.execute("SELECT COALESCE(SUM(CASE correct WHEN 1 THEN ? WHEN 0 THEN ? ELSE 0 END), 0) FROM answer "
                   f"WHERE mode NOT IN ('calibrate', 'testout'){sub}", (RIGHT, TRIED) + ((subject,) if subject else ())).fetchone()[0]
    n = db.execute("SELECT COUNT(*) FROM lesson_state s JOIN lesson l ON l.id = s.lesson_id JOIN unit u ON u.id = l.unit_id "
                   f"WHERE s.learned IS NOT NULL{' AND u.subject_id = ?' if subject else ''}", (subject,) if subject else ()).fetchone()[0]
    return a + LEARNED * n


# ---- lessons and their state ----------------------------------------------------------------------

def lessons(db):
    """Every lesson by id, with its state: mastered, learned, going, ready, needs, unwritten."""
    by = {}
    for r in db.execute("SELECT * FROM v_lesson"):
        l = dict(r)
        l["pre"] = json.loads(l["prereq"] or "[]")
        by[l["id"]] = l
    for l in by.values():
        needs = [p for p in l["pre"] if p in by and by[p]["cards"] and not by[p]["learned"]]
        l["needs"] = needs
        l["state"] = ("unwritten" if not l["cards"] else
                      "mastered" if l["learned"] and l["asks"] and l["mastered"] >= l["asks"] else
                      "learned" if l["learned"] else
                      "going" if l["opened"] or l["seen"] else
                      "needs" if needs else "ready")
    for l in by.values():
        l["unlocks"] = [m["id"] for m in by.values() if l["id"] in m["pre"]]
    return by


def route(by, goal):
    """The goal and what it needs, in the order to do it. Learned lessons end a branch (what they
    needed is no longer your business). Unwritten ones are listed but cannot be done."""
    out = []

    def visit(i, seen):
        if i in seen or i not in by:
            return
        seen.add(i)
        l = by[i]
        if not l["learned"]:
            for p in sorted(l["pre"], key=lambda p: (by[p]["level"] or 0, p) if p in by else (0, p)):
                visit(p, seen)
        out.append(i)
    visit(goal, set())
    return out


def roadmap(db, by=None):
    """The goal you set, the steps still to do and how far along you are; None without a goal."""
    gid = (db.execute("SELECT value FROM setting WHERE key = 'goal_lesson'").fetchone() or [None])[0]
    by = by or lessons(db)
    if gid not in by:
        return None
    steps = route(by, gid)
    todo = [i for i in steps if by[i]["state"] != "unwritten" and not by[i]["learned"]]
    pick = lambda i: {k: by[i][k] for k in ("id", "title", "subject", "subject_id", "level", "state", "minutes")}
    return {"goal": pick(gid), "steps": [pick(i) for i in steps if not by[i]["learned"]],
            "done": sum(1 for i in steps if by[i]["learned"]), "total": len(steps),
            "next": pick(todo[0]) if todo else None, "reached": bool(by[gid]["learned"])}


def set_goal(db, lesson_id):
    if lesson_id:
        db.execute("INSERT INTO setting (key, value) VALUES ('goal_lesson', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                   (lesson_id,))
    else:
        db.execute("DELETE FROM setting WHERE key = 'goal_lesson'")
    db.commit()


def tree(db, subject):
    """A subject's lessons with their state, what each needs and unlocks, and the route's order."""
    by = lessons(db)
    rm = roadmap(db, by)
    order = {s["id"]: n + 1 for n, s in enumerate(rm["steps"])} if rm else {}
    brief = lambda i: {"id": i, "title": by[i]["title"], "state": by[i]["state"], "subject": by[i]["subject"], "subject_id": by[i]["subject_id"]}
    out = []
    for l in sorted((l for l in by.values() if l["subject_id"] == subject), key=lambda l: (l["unit_sort"], l["sort"])):
        out.append({**{k: l[k] for k in ("id", "title", "unit_id", "unit", "unit_sort", "sort", "level", "state", "cards", "asks",
                                         "mastered", "minutes", "kind", "placed", "due", "struggles", "learned")},
                    "needs": [brief(p) for p in l["pre"] if p in by], "unlocks": [brief(i) for i in l["unlocks"]],
                    "step": order.get(l["id"]), "goal": bool(rm and rm["goal"]["id"] == l["id"])})
    return {"subject": subject, "lessons": out, "roadmap": rm, "xp": rank(xp(db, subject))}


def unlocked(db, lesson_id):
    """Lessons that wait on this one and have nothing else to wait for: what finishing it opened."""
    by = lessons(db)
    return [{"id": m["id"], "title": m["title"]} for i in by.get(lesson_id, {}).get("unlocks", [])
            for m in [by[i]] if m["state"] == "ready"]


# ---- badges ---------------------------------------------------------------------------------------

def facts(db, streak, goal=False):
    by = lessons(db)
    done = [l for l in by.values() if l["learned"]]
    units, subjects = {}, {}
    for l in by.values():
        if l["cards"]:
            units.setdefault(l["unit_id"], []).append(l)
            subjects.setdefault(l["subject_id"], []).append(l)
    answers = [r[0] for r in db.execute("SELECT correct FROM answer WHERE correct IS NOT NULL AND mode NOT IN ('calibrate', 'testout') "
                                        "ORDER BY id DESC LIMIT 10")]
    return {
        "answered": db.execute("SELECT COUNT(*) FROM answer WHERE correct IS NOT NULL AND mode NOT IN ('calibrate', 'testout')").fetchone()[0],
        "streak": streak, "goal": goal, "run": len(answers) == 10 and all(answers), "learned": len(done),
        "unit": any(len(v) >= 2 and all(l["learned"] for l in v) for v in units.values()),
        "subject": any(len(v) >= 3 and all(l["learned"] for l in v) for v in subjects.values()),
        "mastered": any(l["state"] == "mastered" for l in by.values()), "top": max((l["level"] or 0 for l in done), default=0),
        "placed": db.execute("SELECT COUNT(*) FROM skill WHERE placed IS NOT NULL").fetchone()[0] > 0,
        "started": len({l["subject_id"] for l in by.values() if l["opened"] or l["seen"]}),
    }


BADGES = [   # id, title, how, test(facts)
    ("first-card", "First answer", "Answer a card", lambda f: f["answered"] >= 1),
    ("cards-100", "100 answers", "Answer 100 cards", lambda f: f["answered"] >= 100),
    ("cards-1000", "1000 answers", "Answer 1000 cards", lambda f: f["answered"] >= 1000),
    ("streak-3", "Three days running", "Study three days in a row", lambda f: f["streak"] >= 3),
    ("streak-7", "A week running", "Study seven days in a row", lambda f: f["streak"] >= 7),
    ("streak-30", "A month running", "Study thirty days in a row", lambda f: f["streak"] >= 30),
    ("run-10", "Ten right", "Get ten answers in a row right", lambda f: f["run"]),
    ("lesson-1", "First lesson", "Learn a lesson (pass its check)", lambda f: f["learned"] >= 1),
    ("lessons-10", "Ten lessons", "Learn ten lessons", lambda f: f["learned"] >= 10),
    ("lessons-25", "Twenty-five lessons", "Learn twenty-five lessons", lambda f: f["learned"] >= 25),
    ("unit", "Unit cleared", "Learn every written lesson in a unit of two or more", lambda f: f["unit"]),
    ("subject", "Subject cleared", "Learn every written lesson in a subject of three or more", lambda f: f["subject"]),
    ("mastered", "Solid", "Get every card in a lesson solid", lambda f: f["mastered"]),
    ("tier-5", "Advanced", "Learn a lesson at stage 5 or above", lambda f: f["top"] >= 5),
    ("tier-7", "Diploma", "Learn a lesson at stage 7 or above", lambda f: f["top"] >= 7),
    ("placed", "Placed", "Find your level in a subject", lambda f: f["placed"]),
    ("explorer", "Explorer", "Start lessons in three subjects", lambda f: f["started"] >= 3),
    ("goal", "Goal reached", "Learn the lesson you set as your goal", lambda f: f["goal"]),
]


def badges(db):
    have = dict(db.execute("SELECT id, at FROM badge").fetchall())
    return [{"id": i, "title": t, "how": h, "at": have.get(i)} for i, t, h, _ in BADGES]


def award(db, streak, goal_learned=None):
    """Earn what is newly true; the badges that are new (each is announced once)."""
    f = facts(db, streak, bool(goal_learned))
    have = {r[0] for r in db.execute("SELECT id FROM badge")}
    new = [(i, t, h) for i, t, h, test in BADGES if i not in have and test(f)]
    for i, _, _ in new:
        db.execute("INSERT INTO badge (id) VALUES (?)", (i,))
    return [{"id": i, "title": t, "how": h} for i, t, h in new]


def after_learn(db, lesson_id, streak):
    """A lesson has just been learned: its XP, what it opened, any goal reached, new badges."""
    gid = (db.execute("SELECT value FROM setting WHERE key = 'goal_lesson'").fetchone() or [None])[0]
    reached = gid == lesson_id
    if reached:
        db.execute("DELETE FROM setting WHERE key = 'goal_lesson'")
    return {"xp": LEARNED, "unlocked": unlocked(db, lesson_id), "goal_reached": reached, "badges": award(db, streak, reached)}


def quests(db, due, struggles_due, goal=None):
    """Three targets, each pointing at something that already earns XP."""
    today = date.today().isoformat()
    learned = db.execute("SELECT COUNT(*) FROM lesson_state WHERE learned = ?", (today,)).fetchone()[0]
    nxt = goal["next"] if goal and goal["next"] else None
    return [
        {"id": "due", "text": "Clear what is due", "done": due == 0, "detail": f"{due} due" if due else "nothing due", "href": "#/review"},
        {"id": "learn", "text": "Learn a lesson", "done": learned > 0, "detail": nxt["title"] if nxt else "pick one in the tree",
         "href": f"#/lesson?id={nxt['id']}" if nxt else "#/tree"},
        {"id": "fix", "text": "Fix a struggling card", "done": struggles_due == 0, "detail": f"{struggles_due} coming back" if struggles_due else "none coming back",
         "href": "#/review"},
    ]
