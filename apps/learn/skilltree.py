"""The skill map: tracks of skills that end in a project, each lesson's state, and your goal.

A track (content/tracks.json) is a line of lessons, each named as something you can do, ending
in a project. A stop is learned when its check is passed, proven once its bench task is logged,
and fresh or fading by how well its cards are remembered now. All of it is worked out from the
answer log and lesson state, so it cannot drift from the real record; only your goal (a track)
is stored. Nothing locks: "needs" is a hint. No points, ranks or badges.
"""
import json
import os
from datetime import date, datetime, timedelta

from . import fsrs

TRACKS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "content", "tracks.json")
FADING = 0.85              # remembered on fewer than this share of its cards' chances: fading
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


def memory(db, ids=None):
    """Each lesson's memory now: the mean chance of recalling its reviewed cards (FSRS), by lesson id."""
    now, out = datetime.now(), {}
    for lid, stab, last in db.execute("SELECT c.lesson_id, s.stability, s.last_review FROM card c "
                                      "JOIN card_state s ON s.card_id = c.id WHERE s.stability IS NOT NULL "
                                      "AND s.last_review IS NOT NULL AND c.source <> 'mistake'"):
        if ids is None or lid in ids:
            out.setdefault(lid, []).append(fsrs.retrievability(stab, (now - datetime.fromisoformat(last)).days))
    return {k: sum(v) / len(v) for k, v in out.items()}


def track_list():
    try:
        return json.load(open(TRACKS, encoding="utf-8"))["tracks"]
    except (OSError, ValueError, KeyError):
        return []                                  # no tracks: no map, and the rest of Learn carries on


def goal(db):
    return (db.execute("SELECT value FROM setting WHERE key = 'goal_track'").fetchone() or [None])[0]


def set_goal(db, track_id):
    if track_id:
        db.execute("INSERT INTO setting (key, value) VALUES ('goal_track', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                   (track_id,))
    else:
        db.execute("DELETE FROM setting WHERE key = 'goal_track'")
    db.commit()


def minutes_left(l):
    """Minutes still to do on a lesson: its length (25 when unsaid), less how far into it you are."""
    if l["learned"] or not l["cards"]:
        return 0
    done = min(1.0, (l["pos"] or 0) / l["cards"])
    return round((l["minutes"] or 25) * (1 - done))


def tracks(db, by=None):
    """Every track with its stops and how far along you are. A stop: proven (learned and its bench
    task logged), learned (fresh or fading), going, ready, needs, or unwritten. A track that needs
    unwritten lessons is blocked, and says how many, with no time estimate."""
    by = by or lessons(db)
    proven = {r[0]: r[1] for r in db.execute("SELECT lesson_id, proven FROM lesson_state WHERE proven IS NOT NULL")}
    mem = memory(db)
    g, out = goal(db), []
    for t in track_list():
        stops = []
        for lid, can in t["stops"]:
            l = by.get(lid)
            if not l:
                continue
            m = mem.get(lid)
            state = "proven" if l["learned"] and lid in proven else "learned" if l["learned"] else l["state"]
            if state == "mastered":
                state = "learned"
            stops.append({"id": lid, "can": can, "title": l["title"], "subject": l["subject"], "subject_id": l["subject_id"],
                          "state": state, "written": bool(l["cards"]), "minutes": l["minutes"] or 25, "left": minutes_left(l),
                          "memory": None if m is None else round(m, 2), "fading": bool(l["learned"] and m is not None and m < FADING),
                          "proven": proven.get(lid), "learned": l["learned"]})
        todo = [x for x in stops if x["written"] and not x["learned"]]
        nxt = next((x for x in todo if x["state"] in ("going", "ready")), todo[0] if todo else None)
        unwritten = sum(not x["written"] for x in stops)
        out.append({**{k: t.get(k) for k in ("id", "title", "project", "counts")}, "stops": stops, "goal": t["id"] == g,
                    "total": len(stops), "written": len(stops) - unwritten, "unwritten": unwritten,
                    "learned": sum(bool(x["learned"]) for x in stops), "proven": sum(x["state"] == "proven" for x in stops),
                    "fading": sum(x["fading"] for x in stops),
                    "left": None if unwritten else sum(x["left"] for x in stops), "left_written": sum(x["left"] for x in stops),
                    "next": nxt, "ready": [x for x in todo if x["state"] == "ready"]})
    return out


def goal_track(db, by=None):
    g = goal(db)
    return next((t for t in tracks(db, by) if t["id"] == g), None) if g else None


def unlocked(db, lesson_id):
    """Lessons that wait on this one and have nothing else to wait for: what finishing it opened."""
    by = lessons(db)
    return [{"id": m["id"], "title": m["title"]} for i in by.get(lesson_id, {}).get("unlocks", [])
            for m in [by[i]] if m["state"] == "ready"]


def after_learn(db, lesson_id):
    """A lesson has just been learned: what it opened, and the next stop on your goal's track."""
    title = (db.execute("SELECT title FROM lesson WHERE id = ?", (lesson_id,)).fetchone() or [lesson_id])[0]
    t = goal_track(db)
    return {"lesson": lesson_id, "title": title, "unlocked": unlocked(db, lesson_id),
            "next": t["next"] if t else None, "track": t["title"] if t else None}


def prove(db, lesson_id, undo=False):
    """Proven: its bench task (or what it says you can do) done for real and logged."""
    db.execute("INSERT INTO lesson_state (lesson_id, pos, proven) VALUES (?, 0, ?) ON CONFLICT(lesson_id) DO UPDATE "
               "SET proven = excluded.proven", (lesson_id, None if undo else date.today().isoformat()))
    db.commit()


def rhythm(db, today=None):
    """This week, Monday to Sunday: which days had a session of five minutes or more, against the target.
    ponytail: a day is one session; two sessions in a day count once."""
    today = today or date.today()
    monday = today - timedelta(days=today.weekday())
    mins = {r[0]: r[1] for r in db.execute("SELECT day, minutes FROM v_learn_day WHERE day >= ?", (monday.isoformat(),))}
    days = [(monday + timedelta(days=i)).isoformat() for i in range(7)]
    target = int((db.execute("SELECT value FROM setting WHERE key = 'rhythm'").fetchone() or [5])[0] or 5)
    return {"days": [{"day": d, "minutes": round(mins.get(d) or 0, 1), "session": (mins.get(d) or 0) >= 5, "future": d > today.isoformat()}
                     for d in days], "sessions": sum((mins.get(d) or 0) >= 5 for d in days), "target": target,
            "minutes": round(sum(mins.values()))}


def cpd(db):
    """The record you could show: by day, minutes studied, lessons learned and skills proven."""
    rows = {}
    for r in db.execute("SELECT day, minutes, cards FROM v_learn_day WHERE minutes > 0 OR cards > 0"):
        rows[r[0]] = {"day": r[0], "minutes": round(r[1] or 0, 1), "cards": r[2], "learned": [], "proven": []}
    for kind in ("learned", "proven"):
        for d, title in db.execute(f"SELECT s.{kind}, l.title FROM lesson_state s JOIN lesson l ON l.id = s.lesson_id "
                                   f"WHERE s.{kind} IS NOT NULL"):
            rows.setdefault(d[:10], {"day": d[:10], "minutes": 0, "cards": 0, "learned": [], "proven": []})[kind].append(title)
    return sorted(rows.values(), key=lambda r: r["day"], reverse=True)


def week(db, today=None):
    """The last seven days in things that count: minutes studied, days studied, lessons learned."""
    today = today or date.today()
    since = (today - timedelta(days=6)).isoformat()
    minutes, days = db.execute("SELECT COALESCE(SUM(minutes), 0), COUNT(*) FROM v_learn_day WHERE day >= ? AND (cards > 0 OR minutes > 0)",
                               (since,)).fetchone()
    learned = db.execute("SELECT COUNT(*) FROM lesson_state WHERE learned >= ?", (since,)).fetchone()[0]
    return {"minutes": round(minutes), "days": days, "learned": learned}
