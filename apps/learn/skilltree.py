"""The skill tree: each lesson's state, what it needs and opens, and the route to a goal.

Worked out from the answer log and lesson state, so it cannot drift from the real record;
only your goal (a setting) is stored. Nothing here locks a lesson: "needs" is a hint.
No points, ranks or badges: progress is what you can do, what you remember and time spent.
"""
import json
from datetime import date, timedelta


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
    return {"subject": subject, "lessons": out, "roadmap": rm}


def unlocked(db, lesson_id):
    """Lessons that wait on this one and have nothing else to wait for: what finishing it opened."""
    by = lessons(db)
    return [{"id": m["id"], "title": m["title"]} for i in by.get(lesson_id, {}).get("unlocks", [])
            for m in [by[i]] if m["state"] == "ready"]


def after_learn(db, lesson_id):
    """A lesson has just been learned: what it opened, and whether it was the goal (which then clears)."""
    gid = (db.execute("SELECT value FROM setting WHERE key = 'goal_lesson'").fetchone() or [None])[0]
    reached = gid == lesson_id
    if reached:
        db.execute("DELETE FROM setting WHERE key = 'goal_lesson'")
    title = (db.execute("SELECT title FROM lesson WHERE id = ?", (lesson_id,)).fetchone() or [lesson_id])[0]
    return {"lesson": lesson_id, "title": title, "unlocked": unlocked(db, lesson_id), "goal_reached": reached}


def week(db, today=None):
    """The last seven days in things that count: minutes studied, days studied, lessons learned."""
    today = today or date.today()
    since = (today - timedelta(days=6)).isoformat()
    minutes, days = db.execute("SELECT COALESCE(SUM(minutes), 0), COUNT(*) FROM v_learn_day WHERE day >= ? AND (cards > 0 OR minutes > 0)",
                               (since,)).fetchone()
    learned = db.execute("SELECT COUNT(*) FROM lesson_state WHERE learned >= ?", (since,)).fetchone()[0]
    return {"minutes": round(minutes), "days": days, "learned": learned}
