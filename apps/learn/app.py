"""Learn: structured courses, and a feed of short cards to use instead of scrolling.

Content lives in files (content/<subject>/subject.json for the outline,
content/<subject>/<unit>/<lesson>.json for a lesson's cards) and is loaded into
learn.db on every start. Progress is kept apart, by card id, so editing the
files never loses it. Your own cards live only in learn.db.

The browser checks the answers; this file schedules them (fsrs.py), keeps your
level (level.py), chooses what comes next and keeps the record.
"""
import csv
import io
import json
import os
import random
import re
from datetime import date, datetime, timedelta

from core import db as _db
from core.api import Err
from . import fsrs, level as _level

HERE = os.path.dirname(os.path.abspath(__file__))
NAME, TITLE, ORDER = "learn", "Learn", 3
MIGRATIONS = os.path.join(HERE, "migrations")
VIEWS = os.path.join(HERE, "views.sql")
CONTENT = os.path.join(HERE, "content")
WIDGETS = os.path.join(HERE, "web", "widgets")
SIGNATURE = "card_state"
SOURCES = {
    "v_learn_day": ["Days studied", "One row a day: cards answered, right first time, minutes."],
    "v_lesson": ["Lessons", "Each lesson: cards, seen, mastered and due."],
    "v_subject": ["Subjects", "Each subject with its progress."],
    "v_card": ["Cards", "Every card with where it sits and how it stands with you."],
    "v_accuracy": ["Accuracy", "How often you are right, by subject."],
    "v_hardest": ["Hardest cards", "The cards that trip you up most."],
}
OTHERS = ("money", "log")
LABELS = {"card": "card", "card_state": "review", "lesson_state": "lesson place", "study": "study time"}
# the courses are files, loaded on every start; only your own subjects, lessons and cards sync
SYNC_WHERE = {t: "{r}.source <> 'file'" for t in ("subject", "unit", "lesson", "card")}
TYPES = ("concept", "widget", "mcq", "numeric", "steps", "order", "match", "flash", "code")

SEARCH = [
    ("card", "SELECT c.id, c.lesson_id, c.type, c.text, l.title AS lesson, s.title AS subject FROM card c "
             "JOIN lesson l ON l.id = c.lesson_id JOIN unit u ON u.id = l.unit_id JOIN subject s ON s.id = u.subject_id",
     ["c.text", "c.data", "l.title"], None, "c.lesson_id, c.sort"),
    ("lesson", "SELECT l.id, l.title, u.title AS unit, s.title AS subject FROM lesson l JOIN unit u ON u.id = l.unit_id "
               "JOIN subject s ON s.id = u.subject_id", ["l.title", "u.title", "l.tags"], None, "s.sort, u.sort, l.sort"),
]


# --- content from files ---------------------------------------------------------------

STAGES = ("try", "learn", "example", "practise", "mix", "check", "calibrate")
KINDS = ("procedure", "concept", "facts")


def front(card):
    """The words a card leads with, for lists and search."""
    ask = card.get("ask") or {}
    return str(card.get("q") or card.get("front") or card.get("title") or card.get("intro") or ask.get("q")
               or card.get("body") or "").strip()[:400]


def _floor(card):
    """The chance of getting a card right by guessing: 1/options for multiple choice."""
    c = card.get("ask") if card.get("type") == "widget" else card
    return round(1 / len(c["options"]), 3) if c and c.get("type") == "mcq" and c.get("options") else 0.0


def _json(v):
    return json.dumps(v, ensure_ascii=False) if v else None


def read_content(folder=CONTENT):
    """Everything under content/: (subjects, units, lessons, cards) as rows. Raises ValueError on a broken file.
    A lesson file may also carry its level, kind, minutes, goals, summary, resources and sources;
    calibrate.json in a subject's folder holds its calibration questions, each naming its lesson."""
    subjects, units, lessons, cards = [], [], [], []
    for si, sname in enumerate(sorted(os.listdir(folder)) if os.path.isdir(folder) else []):
        sdir = os.path.join(folder, sname)
        outline = os.path.join(sdir, "subject.json")
        if not os.path.isfile(outline):
            continue
        try:
            s = json.load(open(outline, encoding="utf-8"))
        except ValueError as e:
            raise ValueError(f"{outline}: {e}")
        subjects.append({"id": s["id"], "title": s["title"], "sort": s.get("sort", si), "note": s.get("note")})
        for ui, u in enumerate(s.get("units", [])):
            units.append({"id": u["id"], "subject_id": s["id"], "title": u["title"], "sort": ui, "level": u.get("level")})
            for li, les in enumerate(u.get("lessons", [])):
                lessons.append({"id": les["id"], "unit_id": u["id"], "title": les["title"], "sort": li,
                                "star": int(bool(les.get("star"))), "prereq": json.dumps(les.get("prereq") or []),
                                "tags": " ".join(les.get("tags") or []), "note": les.get("note"),
                                "level": les.get("level", u.get("level")), "kind": les.get("kind"), "minutes": les.get("minutes"),
                                "goals": None, "summary": None, "resources": None, "sources": None})
        by_id = {x["id"]: x for x in lessons}

        def add_card(c, lesson_id, sort, path, stage=None):
            if c.get("type") not in TYPES:
                raise ValueError(f"{path}: card {c.get('id')!r} has no type, or one Learn does not know")
            if not c.get("id"):
                raise ValueError(f"{path}: card {sort + 1} has no id (ids are forever: progress hangs off them)")
            st = c.get("stage", stage)
            if st is not None and st not in STAGES:
                raise ValueError(f"{path}: card {c['id']!r} has stage {st!r}; the stages are {', '.join(STAGES)}")
            cards.append({"id": f"{lesson_id}/{c['id']}", "lesson_id": lesson_id, "sort": sort, "type": c["type"],
                          "text": front(c), "data": json.dumps(c, ensure_ascii=False), "level": c.get("level"), "stage": st})

        for root, _dirs, files in os.walk(sdir):
            for f in sorted(files):
                if not f.endswith(".json") or f == "subject.json":
                    continue
                path = os.path.join(root, f)
                try:
                    les = json.load(open(path, encoding="utf-8"))
                except ValueError as e:
                    raise ValueError(f"{path}: {e}")
                if f == "calibrate.json":                  # the calibration bank: questions across the whole outline
                    for ci, c in enumerate(les.get("cards", [])):
                        if c.get("lesson") not in by_id:
                            raise ValueError(f"{path}: card {c.get('id')!r} names lesson {c.get('lesson')!r}, not in the outline")
                        add_card(c, c["lesson"], 2000 + ci, path, "calibrate")
                    continue
                row = by_id.get(les.get("id"))
                if not row:
                    raise ValueError(f"{path}: lesson {les.get('id')!r} is not in {s['id']}'s subject.json")
                for k in ("title", "note", "level", "kind", "minutes", "summary"):
                    if les.get(k) is not None:
                        row[k] = les[k]
                if les.get("kind") and les["kind"] not in KINDS:
                    raise ValueError(f"{path}: kind {les['kind']!r}; the kinds are {', '.join(KINDS)}")
                for k in ("goals", "resources", "sources"):
                    row[k] = _json(les.get(k))
                if "prereq" in les:
                    row["prereq"] = json.dumps(les["prereq"])
                if "tags" in les:
                    row["tags"] = " ".join(les["tags"])
                for ci, c in enumerate(les.get("cards", [])):
                    add_card(c, les["id"], ci, path)
    return subjects, units, lessons, cards


def formulas(folder=CONTENT):
    """Formula help: every formula a lesson explains (its "formulas") and the maths notation
    they are written in (content/symbols.json). Read from the files each time: they are small."""
    out = {"formulas": [], "symbols": []}
    sym = os.path.join(folder, "symbols.json")
    if os.path.isfile(sym):
        out["symbols"] = json.load(open(sym, encoding="utf-8")).get("symbols", [])
    for sname in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        sdir = os.path.join(folder, sname)
        if not os.path.isfile(os.path.join(sdir, "subject.json")):
            continue
        s = json.load(open(os.path.join(sdir, "subject.json"), encoding="utf-8"))
        titles = {les["id"]: les["title"] for u in s.get("units", []) for les in u.get("lessons", [])}
        for root, _dirs, files in os.walk(sdir):
            for f in sorted(files):
                if not f.endswith(".json") or f in ("subject.json", "calibrate.json"):
                    continue
                les = json.load(open(os.path.join(root, f), encoding="utf-8"))
                for fm in les.get("formulas") or []:
                    out["formulas"].append({**fm, "lesson": les.get("id"), "lesson_title": titles.get(les.get("id")),
                                            "subject": s["title"], "subject_id": s["id"]})
    return out


def after_migrate(db):
    """Load the files: replace every row that came from a file, keep your own and all progress."""
    subjects, units, lessons, cards = read_content()
    db.execute("BEGIN")
    for t in ("card", "lesson", "unit", "subject"):
        db.execute(f"DELETE FROM {t} WHERE source = 'file'")
    for t, rows in (("subject", subjects), ("unit", units), ("lesson", lessons), ("card", cards)):
        for r in rows:
            cols = list(r)
            db.execute(f"INSERT OR IGNORE INTO {t} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                       [r[c] for c in cols])
    db.commit()


# --- what the suite asks of every app --------------------------------------------------

def _settings(db):
    s = _db.settings(db)
    on = json.loads(s.get("subjects_on") or "[]")
    return s, on, json.loads(s.get("weights") or "{}")


def _now():
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def today_counts(db):
    s = _db.settings(db)
    d = date.today().isoformat()
    cards, minutes = db.execute("SELECT COALESCE(SUM(cards), 0), COALESCE(SUM(minutes), 0) FROM v_learn_day WHERE day = ?",
                                (d,)).fetchone()
    due = db.execute("SELECT COUNT(*) FROM v_card WHERE asks AND due IS NOT NULL AND due <= ?", (_now(),)).fetchone()[0]
    kind, goal = s.get("goal_kind", "cards"), float(s.get("goal") or 20)
    return {"cards": cards, "minutes": round(minutes, 1), "due": due, "goal_kind": kind, "goal": goal,
            "done": cards if kind == "cards" else round(minutes, 1), "streak": streak(db)}


def streak(db, today=None):
    """Days in a row with at least one card, up to today (or yesterday, if nothing yet today)."""
    days = {r[0] for r in db.execute("SELECT DISTINCT day FROM answer")}
    d = today or date.today()
    if d.isoformat() not in days:
        d -= timedelta(days=1)
    n = 0
    while d.isoformat() in days:
        n += 1
        d -= timedelta(days=1)
    return n


def home(db):
    t = today_counts(db)
    last = db.execute("SELECT l.id, l.title FROM lesson_state s JOIN lesson l ON l.id = s.lesson_id "
                      "WHERE s.finished IS NULL ORDER BY COALESCE(s.seen, s.started) DESC LIMIT 1").fetchone()
    unit = "cards" if t["goal_kind"] == "cards" else "minutes"
    return {"ring": {"done": int(t["done"]), "goal": int(t["goal"]), "label": f"{unit} today"},
            "figures": [{"label": "Due", "value": str(t["due"]), "sub": "to review", "href": "#/review" if t["due"] else "#/today"},
                        {"label": "Streak", "value": f"{t['streak']} day{'s' if t['streak'] != 1 else ''}", "href": "#/stats"}],
            "links": [{"label": "Start the feed", "href": "#/feed"}]
                     + ([{"label": "Review", "href": "#/review"}] if t["due"] else [])
                     + ([{"label": f"Continue: {last['title']}", "href": f"#/lesson?id={last['id']}"}] if last else [])}


def calendar(db, frm, to):
    """A daily 'review in Learn' in the calendar feed, when switched on (Learn → Settings)."""
    if _db.settings(db).get("review_reminder") != "1":
        return []
    today = date.today()
    start = max(date.fromisoformat(frm), today)
    end = min(date.fromisoformat(to), today + timedelta(days=60))
    due = today_counts(db)["due"]
    out, d = [], start
    while d <= end:
        out.append({"uid": f"review-{d}", "date": d.isoformat(),
                    "title": f"Learn: review ({due} due)" if d == today else "Learn: review"})
        d += timedelta(days=1)
    return out


def inspect(count, span):
    return [["Cards answered", f"{count('answer')}"], ["Cards with progress", str(count("card_state"))],
            ["Your own cards", str(count("card"))]]


# --- what comes next --------------------------------------------------------------------

def _card(r, why):
    d = json.loads(r["data"])
    st = None
    if r["reps"] is not None or r["due"] or r["stability"] is not None:
        st = {k: r[k] for k in ("due", "interval_days", "ease", "reps", "lapses", "stability", "difficulty", "phase", "struggle")}
    return {"id": r["id"], "type": r["type"], "lesson_id": r["lesson_id"], "lesson": r["lesson"],
            "subject_id": r["subject_id"], "subject": r["subject"], "why": why, "card": d,
            "level": r["level"], "stage": r["stage"], "state": st}


CARD_SQL = ("SELECT c.id, c.type, c.lesson_id, c.data, v.lesson, v.subject_id, v.subject, v.due, v.interval_days, "
            "v.ease, v.reps, v.lapses, v.last_seen, v.stability, v.difficulty, v.phase, v.struggle, v.level, v.stage, "
            "v.unit_id, v.last_review FROM card c JOIN v_card v ON v.id = c.id ")

# The feed's pattern for every ten cards: mostly what is due, a fixed share of what you are
# struggling with, some new, some practice. A kind with nothing left gives way to the next.
CYCLE = ("review", "struggle", "review", "new", "review", "practice", "review", "struggle", "new", "review")


def recent_rate(db, n=20):
    """How often you were right in your last n answers today, or None with fewer than 8."""
    rows = [r[0] for r in db.execute("SELECT correct FROM answer WHERE day = ? AND correct IS NOT NULL "
                                     "AND mode IN ('feed','review','comeback') ORDER BY id DESC LIMIT ?",
                                     (date.today().isoformat(), n))]
    return sum(rows) / len(rows) if len(rows) >= 8 else None


def frontier(db, subject_id):
    """The lessons to learn next in a subject, in course order: written, not learned, not placed
    as known, and no more than 0.7 above your level there once you have one."""
    k = db.execute("SELECT theta FROM skill WHERE scope = ?", (subject_id,)).fetchone()
    top = _level.level(k["theta"]) + 0.7 if k else None
    out = []
    for r in db.execute("SELECT * FROM v_lesson WHERE subject_id = ? AND cards > 0 ORDER BY unit_sort, sort", (subject_id,)):
        if r["learned"] or r["placed"] == "known":
            continue
        if top is not None and r["level"] is not None and r["level"] > top:
            continue
        out.append(r)
    return out


def feed(db, n=10, exclude=(), subjects=None, rng=random, at=0):
    """The next n cards (§4 of LEARN-SPEC): due reviews, struggles, the next new card of the
    lessons you are on, and practice from your weakest topics, in a fixed pattern. Subjects
    take turns by weight. Right less than 70% of the time lately: no new cards for now;
    more than 92%: new cards in place of practice."""
    _s, on, weights = _settings(db)
    now = _now()
    subs = subjects or on or [r[0] for r in db.execute("SELECT DISTINCT subject_id FROM v_card")]
    subs = [s for s in subs if s]
    ex = set(exclude)
    rate = recent_rate(db)
    pools = {}
    for s in subs:
        due = [r for r in db.execute(CARD_SQL + "WHERE v.subject_id = ? AND v.asks AND v.due IS NOT NULL AND v.due <= ? "
                                                "ORDER BY v.due", (s, now)) if r["id"] not in ex]
        new = []
        for les in frontier(db, s):
            new += [r for r in db.execute(CARD_SQL + "WHERE c.lesson_id = ? AND v.reps IS NULL AND v.last_seen IS NULL "
                                                     "AND c.source <> 'mistake' AND COALESCE(v.stage, '') <> 'calibrate' "
                                                     "ORDER BY c.sort", (les["id"],)) if r["id"] not in ex]
            if len(new) >= n:
                break
        weak = {r[0]: r[1] for r in db.execute("SELECT u.scope, u.theta - s.theta FROM skill u JOIN unit x ON x.id = u.scope "
                                               "JOIN skill s ON s.scope = x.subject_id WHERE x.subject_id = ?", (s,))}
        practice = sorted((r for r in db.execute(CARD_SQL + "WHERE v.subject_id = ? AND c.type = 'numeric' AND v.reps > 0", (s,))
                           if r["id"] not in ex), key=lambda r: (weak.get(r["unit_id"], 0), rng.random()))
        pools[s] = {"review": [r for r in due if not r["struggle"]], "struggle": [r for r in due if r["struggle"]],
                    "new": new, "practice": practice}
    out, k = [], at
    while len(out) < n:
        live = [s for s in subs if any(pools[s].values())]
        if not live:
            break
        want = CYCLE[k % len(CYCLE)]
        k += 1
        if want == "new" and rate is not None and rate < 0.7:
            want = "practice"
        elif want == "practice" and rate is not None and rate > 0.92:
            want = "new"
        order = [want] + [w for w in ("review", "struggle", "new", "practice") if w != want]
        for why in order:
            have = [s for s in live if pools[s][why]]
            if not have:
                continue
            s = rng.choices(have, weights=[float(weights.get(x, 1) or 0) or 0.0001 for x in have])[0]
            out.append(_card(pools[s][why].pop(0), why))
            break
    return out


def due_cards(db, limit=200):
    return [_card(r, "review") for r in db.execute(CARD_SQL + "WHERE v.asks AND v.due IS NOT NULL AND v.due <= ? "
                                                              "ORDER BY v.struggle DESC, v.due LIMIT ?", (_now(), limit))]


def lesson_cards(db, lesson_id):
    return [_card(r, "lesson") for r in db.execute(CARD_SQL + "WHERE c.lesson_id = ? AND c.source <> 'mistake' "
                                                              "AND COALESCE(v.stage, '') <> 'calibrate' "
                                                              "ORDER BY c.sort, c.id", (lesson_id,))]


def warmup(db, lesson, n=3):
    """Before a lesson: what is due, or least solid, from the lessons it builds on."""
    ids = json.loads(lesson["prereq"] or "[]")
    if not ids:
        return []
    rows = [r for r in db.execute(CARD_SQL + f"WHERE c.lesson_id IN ({','.join('?' * len(ids))}) AND v.asks AND v.reps > 0 "
                                             "AND c.source <> 'mistake'", ids)]
    now = datetime.now()
    rows.sort(key=lambda r: _recall(r, now))
    return [_card(r, "warmup") for r in rows[:n]]


def practice(db, lessons, n=10, rng=random):
    rows = [r for r in db.execute(CARD_SQL + f"WHERE c.type = 'numeric' AND c.lesson_id IN ({','.join('?' * len(lessons))}) "
                                             "AND COALESCE(v.stage, '') <> 'calibrate'", lessons)] if lessons else []
    return [_card(rng.choice(rows), "practice") for _ in range(n)] if rows else []


def _recall(r, now=None):
    """The chance you remember a card now (0 for one never learned)."""
    if r["stability"] is None or not r["last_review"]:
        return 0.0
    days = ((now or datetime.now()) - datetime.fromisoformat(r["last_review"])).days
    return fsrs.retrievability(r["stability"], days)


# --- keeping the record ----------------------------------------------------------------------

COLD_MODES = ("calibrate", "checkpoint", "testout", "review", "comeback")
NO_SCHEDULE = ("calibrate", "testout")              # these ask, but only to find your level


def _rating(body, card_type, correct):
    if body.get("too_easy"):
        return "easy"
    if body.get("rating") in fsrs.RATINGS and card_type in ("flash", "steps"):
        return body["rating"]                        # you rated it yourself
    if correct is None:
        return None
    if not correct:
        return "again"
    return "hard" if body.get("confidence") == 0 else "good"      # a right guess counts for less


def _due_text(when, days):
    # a review in days is due from the start of that day, so it is there in the morning
    return (when.replace(hour=0, minute=0) if days else when).strftime("%Y-%m-%d %H:%M")


def answer(db, body):
    """One card done. The server schedules it (FSRS), keeps the struggle count, updates your
    level from answers that count, makes a flash card of a wrong one, and says what should
    come back: the same card soon after a confident mistake, and a refresher from the lesson
    it builds on when that is not solid."""
    cid = body.get("card_id")
    card = db.execute("SELECT v.*, c.data FROM v_card v JOIN card c ON c.id = v.id WHERE v.id = ?", (cid,)).fetchone()
    if not card:
        raise Err(404, "no such card")
    mode = body.get("mode") or "feed"
    now_dt = datetime.now()
    now, today = now_dt.strftime("%Y-%m-%d %H:%M"), date.today().isoformat()
    correct = body.get("correct")
    conf = body.get("confidence") if body.get("confidence") in (0, 1, 2) else None
    st = db.execute("SELECT * FROM card_state WHERE card_id = ?", (cid,)).fetchone()
    if body.get("too_easy") and not (st and st["stability"] is not None):
        raise Err(400, "a new card needs an answer first: a right one sends it further out")
    rating = _rating(body, card["type"], correct) if card["asks"] else None
    new_state = None
    if not card["asks"] or rating is None:           # read, not rated: seen, and not scheduled
        db.execute("INSERT INTO card_state (card_id, last_rating, last_seen) VALUES (?, 'seen', ?) "
                   "ON CONFLICT(card_id) DO UPDATE SET last_seen = excluded.last_seen", (cid, now))
    elif mode not in NO_SCHEDULE:
        was_review = bool(st and st["phase"] == "review")
        early = was_review and st["due"] and st["due"] > now
        if not (early and rating != "again") or body.get("too_easy"):   # practising a card not yet due leaves it be
            prev = {"phase": st["phase"], "stability": st["stability"], "difficulty": st["difficulty"],
                    "last_review": st["last_review"]} if st and st["stability"] is not None else None
            retention = float(_db.settings(db).get("desired_retention") or 0.9)
            new_state = fsrs.review(prev, rating, now_dt, retention)
        right_days = (st["right_days"] if st else 0) or 0
        last_right = st["last_right_day"] if st else None
        seen_before = bool(st and (st["reps"] or st["lapses"] or st["stability"] is not None)) and \
            (st["last_review"] or "")[:10] < today
        struggle = (st["struggle"] if st else 0) or 0
        lapses = (st["lapses"] if st else 0) or 0
        if rating == "again":
            right_days, last_right = 0, None
            if seen_before or conf == 2:
                struggle = 1                          # missed after learning it, or missed while sure
            if was_review:
                lapses += 1
        elif correct is not False:
            if last_right != today:
                right_days, last_right = right_days + 1, today
            if struggle and right_days >= 3:
                struggle = 0                          # right on three separate days: out of Coming back
        vals = {"last_rating": rating, "last_seen": now, "right_days": right_days, "last_right_day": last_right,
                "struggle": struggle, "lapses": lapses}
        if new_state:
            vals.update(due=_due_text(new_state["due"], new_state["days"]), interval_days=new_state["days"],
                        stability=new_state["stability"], difficulty=new_state["difficulty"], phase=new_state["phase"],
                        last_review=now, reps=((st["reps"] if st else 0) or 0) + (rating != "again"))
        cols = list(vals)
        db.execute(f"INSERT INTO card_state (card_id, {','.join(cols)}) VALUES (?{',?' * len(cols)}) "
                   f"ON CONFLICT(card_id) DO UPDATE SET {','.join(f'{c}=excluded.{c}' for c in cols)}",
                   [cid] + [vals[c] for c in cols])
    data = json.loads(card["data"])
    lv = card["level"]
    cold = int(bool(card["asks"] and correct is not None and lv is not None and (
        mode in COLD_MODES or card["stage"] in ("try", "check")
        or bool(st and st["last_review"] and st["last_review"][:10] < today))))
    db.execute("INSERT INTO answer (card_id, lesson_id, subject_id, mode, correct, rating, ms, confidence, level, floor, cold) "
               "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
               (cid, card["lesson_id"], card["subject_id"], mode, None if correct is None else int(bool(correct)), rating,
                int(body.get("ms") or 0), conf, lv, _floor(data), cold))
    made = None
    if correct is False and card["source"] != "mistake" and body.get("mistake") and mode not in NO_SCHEDULE:
        m = body["mistake"]
        made = f"mistake/{cid}"
        mdata = json.dumps({"id": made, "type": "flash", "front": m.get("front", ""), "back": m.get("back", ""), "from": cid},
                           ensure_ascii=False)
        db.execute("INSERT INTO card (id, lesson_id, type, text, data, source) VALUES (?, ?, 'flash', ?, ?, 'mistake') "
                   "ON CONFLICT(id) DO UPDATE SET text = excluded.text, data = excluded.data",
                   (made, card["lesson_id"], m.get("front", "")[:400], mdata))
        db.execute("INSERT INTO card_state (card_id, due, reps, lapses) VALUES (?, ?, 0, 0) "
                   "ON CONFLICT(card_id) DO UPDATE SET due = excluded.due", (made, now))
    lvl = update_skill(db, card["subject_id"], card["unit_id"], mode) if cold else None
    repair = []
    if correct is False and mode not in NO_SCHEDULE and body.get("repair", True):
        repair = shaky_prereqs(db, card["lesson_id"])
    db.commit()
    show = None
    if new_state:
        show = "Back in ten minutes" if not new_state["days"] else \
            f"Next in {new_state['days']} day{'s' if new_state['days'] != 1 else ''}"
    return {"ok": True, "mistake": made, "today": today_counts(db), "next": show,
            "retest": bool(correct is False and conf == 2), "repair": repair, "level": lvl,
            "struggle": bool(card["asks"] and rating == "again" and (db.execute(
                "SELECT struggle FROM card_state WHERE card_id = ?", (cid,)).fetchone() or [0])[0])}   # none after a calibration


def shaky_prereqs(db, lesson_id, n=3):
    """A missed card whose lesson builds on one that is not solid: a few cards from that one first."""
    les = db.execute("SELECT prereq FROM lesson WHERE id = ?", (lesson_id,)).fetchone()
    ids = json.loads(les["prereq"] or "[]") if les else []
    now = datetime.now()
    for pid in ids:
        rows = [r for r in db.execute(CARD_SQL + "WHERE c.lesson_id = ? AND v.asks AND c.source <> 'mistake' "
                                                 "AND COALESCE(v.stage, '') <> 'calibrate'", (pid,))]
        if not rows:
            continue
        learned = db.execute("SELECT learned FROM lesson_state WHERE lesson_id = ?", (pid,)).fetchone()
        seen = [r for r in rows if r["stability"] is not None]
        mean = sum(_recall(r, now) for r in seen) / len(seen) if seen else 0
        if (learned and learned[0] and mean >= 0.8) or (seen and mean >= 0.8):
            continue
        pick = sorted(rows, key=lambda r: (r["stage"] != "check", _recall(r, now)))[:n]
        return [_card(r, "refresher") for r in pick]
    return []


# --- your level ------------------------------------------------------------------------------

def _answers_for(db, where, args, limit=800):
    rows = db.execute(f"SELECT a.level, a.floor, a.correct, a.day, a.confidence FROM answer a {where} "
                      "AND a.cold = 1 AND a.correct IS NOT NULL AND a.level IS NOT NULL ORDER BY a.id DESC LIMIT ?",
                      (*args, limit)).fetchall()
    return [(r["level"], r["floor"] or 0, r["correct"], r["day"], 0.5 if r["correct"] and r["confidence"] == 0 else 1.0)
            for r in rows]


def update_skill(db, subject_id, unit_id=None, why=None):
    """Work out your level in a subject, and in the unit, from every answer that counts."""
    if not subject_id:
        return None
    today = date.today()
    k = db.execute("SELECT prior FROM skill WHERE scope = ?", (subject_id,)).fetchone()
    prior, prior_sd = (k["prior"], 1.5) if k and k["prior"] is not None else (4.0 + _level.EIGHTY, 2.0)
    ans = _answers_for(db, "WHERE a.subject_id = ?", (subject_id,))
    if not ans and not (k and k["prior"] is not None):
        return None                                   # nothing to go on yet
    theta, sd = _level.estimate(ans, prior, prior_sd, today)
    _put_skill(db, subject_id, theta, sd, len(ans), why)
    units = [unit_id] if unit_id else [r[0] for r in db.execute("SELECT id FROM unit WHERE subject_id = ?", (subject_id,))]
    for u in units:
        ua = _answers_for(db, "JOIN lesson l ON l.id = a.lesson_id WHERE l.unit_id = ?", (u,))
        if ua:
            ut, us = _level.estimate(ua, theta, 1.0, today)
            _put_skill(db, u, ut, us, len(ua), why)
    return _level.describe(theta, sd)


def _put_skill(db, scope, theta, sd, n, why):
    db.execute("INSERT INTO skill (scope, theta, sd, n, updated) VALUES (?,?,?,?,?) ON CONFLICT(scope) DO UPDATE SET "
               "theta = excluded.theta, sd = excluded.sd, n = excluded.n, updated = excluded.updated",
               (scope, theta, sd, n, _now()))
    db.execute("INSERT INTO skill_log (day, scope, theta, sd, why) VALUES (?,?,?,?,?) ON CONFLICT(day, scope) DO UPDATE SET "
               "theta = excluded.theta, sd = excluded.sd, why = excluded.why", (date.today().isoformat(), scope, theta, sd, why))


def levels(db):
    """Every subject's and unit's level, with its history, and the scale."""
    rows = [dict(r) for r in db.execute("SELECT * FROM v_skill ORDER BY kind DESC, subject_id, unit_sort")]
    for r in rows:
        r.update(_level.describe(r["theta"], r["sd"]))
    hist = {}
    for r in db.execute("SELECT l.* FROM skill_log l JOIN subject s ON s.id = l.scope ORDER BY l.day"):
        hist.setdefault(r["scope"], []).append({"day": r["day"], **_level.describe(r["theta"], r["sd"])})
    return {"skills": rows, "history": hist,
            "stages": [{"stage": n, "name": name, "about": about, "rqf": rqf} for n, name, about, rqf in _level.STAGES]}


# --- calibration: an adaptive test to place you in a subject ---------------------------------

ASKS = ("mcq", "numeric", "order", "match", "code", "widget")


def calibrate_start(db, subject_id, said):
    """Where you think you are (a stage) is only the starting point."""
    if not db.execute("SELECT 1 FROM subject WHERE id = ?", (subject_id,)).fetchone():
        raise Err(404, "no such subject")
    prior = float(said) + _level.EIGHTY if said not in (None, "") else None
    db.execute("INSERT INTO skill (scope, theta, sd, prior, updated) VALUES (?, ?, 1.5, ?, ?) ON CONFLICT(scope) DO UPDATE "
               "SET prior = excluded.prior", (subject_id, prior if prior is not None else 4.0 + _level.EIGHTY, prior, _now()))
    db.commit()
    return {"ok": True}


def calibrate_next(db, subject_id, asked, rng=random):
    """The next question: from the unit asked least so far, the one nearest your level as it
    stands. Done when the range is ±0.35 or narrower, or at the set number of questions."""
    k = db.execute("SELECT theta, sd FROM skill WHERE scope = ?", (subject_id,)).fetchone()
    theta, sd = (k["theta"], k["sd"]) if k else (4.0 + _level.EIGHTY, 2.0)
    limit = int(_db.settings(db).get("calibration_length") or 15)
    asked = [a for a in asked if a]
    if (len(asked) >= 5 and sd <= 0.35) or len(asked) >= limit:
        return {"done": True, "result": calibrate_result(db, subject_id)}
    rows = [r for r in db.execute(CARD_SQL + "WHERE v.subject_id = ? AND v.level IS NOT NULL AND c.source = 'file' "
                                             f"AND c.type IN ({','.join('?' * len(ASKS))})", (subject_id, *ASKS))
            if r["id"] not in asked and r["type"] != "widget"]
    if not rows:
        return {"done": True, "result": calibrate_result(db, subject_id)}
    unit_of = {r["id"]: r["unit_id"] for r in db.execute("SELECT id, unit_id FROM v_card WHERE subject_id = ?", (subject_id,))}
    count = {}
    for a in asked:
        count[unit_of.get(a)] = count.get(unit_of.get(a), 0) + 1
    near = [r for r in rows if abs(r["level"] - theta) <= 1.5] or rows
    least = min(count.get(r["unit_id"], 0) for r in near)
    pool = [r for r in near if count.get(r["unit_id"], 0) == least]
    pool.sort(key=lambda r: (abs(r["level"] - theta) + rng.random() * 0.4, r["stage"] != "calibrate"))
    return {"done": False, "item": _card(pool[0], "calibrate"), "asked": len(asked), "of": limit,
            "now": _level.describe(theta, sd)}


def calibrate_result(db, subject_id):
    """Your level, the units, and where to start: lessons well below your level are
    'probably known' (a test out settles it), the first one at your level is 'start here'."""
    lv = update_skill(db, subject_id, None, "calibrate")
    db.execute("UPDATE skill SET placed = ? WHERE scope = ?", (_now(), subject_id))
    k = db.execute("SELECT theta FROM skill WHERE scope = ?", (subject_id,)).fetchone()
    mine = _level.level(k["theta"])
    ulv = {r["scope"]: _level.level(r["theta"]) for r in db.execute(
        "SELECT scope, theta FROM skill WHERE scope IN (SELECT id FROM unit WHERE subject_id = ?)", (subject_id,))}
    start = None
    for les in db.execute("SELECT * FROM v_lesson WHERE subject_id = ? ORDER BY unit_sort, sort", (subject_id,)):
        placed = None
        if not les["learned"] and les["level"] is not None:
            here = ulv.get(les["unit_id"], mine)
            if les["level"] <= min(mine, here) - 1.0:
                placed = "known"
            elif start is None and les["cards"]:
                placed = start = "start"
        db.execute("INSERT INTO lesson_state (lesson_id, pos, placed) VALUES (?, 0, ?) "
                   "ON CONFLICT(lesson_id) DO UPDATE SET placed = excluded.placed", (les["id"], placed))
    db.commit()
    units = [dict(r, **_level.describe(r["theta"], r["sd"])) for r in db.execute(
        "SELECT * FROM v_skill WHERE subject_id = ? AND kind = 'unit' ORDER BY unit_sort", (subject_id,))]
    first = db.execute("SELECT l.id, l.title, l.level FROM lesson_state s JOIN v_lesson l ON l.id = s.lesson_id "
                       "WHERE s.placed = 'start' AND l.subject_id = ? LIMIT 1", (subject_id,)).fetchone()
    known = db.execute("SELECT COUNT(*) FROM lesson_state s JOIN v_lesson l ON l.id = s.lesson_id "
                       "WHERE s.placed = 'known' AND l.subject_id = ?", (subject_id,)).fetchone()[0]
    return {"subject": lv, "units": units, "start": dict(first) if first else None, "known": known}


# --- checkpoints, test out, the weekly comeback ----------------------------------------------

def checkpoint(db, unit_id, n=10, rng=random):
    """A mixed check of a unit, with some of the units before it: cold questions, your level after."""
    u = db.execute("SELECT * FROM unit WHERE id = ?", (unit_id,)).fetchone()
    if not u:
        raise Err(404, "no such unit")
    here = [r for r in db.execute(CARD_SQL + "WHERE v.unit_id = ? AND v.asks AND c.source = 'file' "
                                             "AND COALESCE(v.stage, '') NOT IN ('calibrate', 'learn')", (unit_id,))]
    before = [r for r in db.execute(CARD_SQL + "JOIN unit x ON x.id = v.unit_id WHERE v.subject_id = ? AND x.sort < ? "
                                               "AND v.asks AND v.reps > 0 AND c.source = 'file'", (u["subject_id"], u["sort"]))]
    rng.shuffle(here)
    rng.shuffle(before)
    pick = here[:n - min(3, len(before))]
    pick += before[:n - len(pick)]
    rng.shuffle(pick)
    return [_card(r, "checkpoint") for r in pick]


def testout(db, lesson_id, n=4):
    """A lesson you may already know: its hardest check and practice questions."""
    rows = [r for r in db.execute(CARD_SQL + "WHERE c.lesson_id = ? AND v.asks AND c.source = 'file' "
                                             "AND COALESCE(v.stage, '') <> 'calibrate'", (lesson_id,))]
    rows.sort(key=lambda r: (r["stage"] not in ("check", "practise", "mix"), -(r["level"] or 0)))
    return [_card(r, "testout") for r in rows[:n]]


def testout_done(db, lesson_id, right, asked):
    """All right: the lesson is learned, and its cards start as reviews a week or so out."""
    passed = bool(asked) and right >= asked
    if passed:
        now = datetime.now()
        db.execute("INSERT INTO lesson_state (lesson_id, pos, learned) VALUES (?, 0, ?) ON CONFLICT(lesson_id) DO UPDATE "
                   "SET learned = excluded.learned, placed = NULL", (lesson_id, date.today().isoformat()))
        for r in db.execute("SELECT c.id FROM card c LEFT JOIN card_state s ON s.card_id = c.id WHERE c.lesson_id = ? "
                            "AND c.type <> 'concept' AND c.source = 'file' AND s.stability IS NULL", (lesson_id,)).fetchall():
            ns = fsrs.review(None, "easy", now)
            db.execute("INSERT INTO card_state (card_id, due, interval_days, stability, difficulty, phase, last_review, reps, "
                       "last_rating, last_seen) VALUES (?,?,?,?,?,?,?,1,'easy',?) ON CONFLICT(card_id) DO UPDATE SET "
                       "due=excluded.due, interval_days=excluded.interval_days, stability=excluded.stability, "
                       "difficulty=excluded.difficulty, phase=excluded.phase, last_review=excluded.last_review",
                       (r[0], _due_text(ns["due"], ns["days"]), ns["days"], ns["stability"], ns["difficulty"], "review",
                        _now(), _now()))
    db.commit()
    return {"passed": passed}


def comeback(db, days=7):
    """The week's misses, once more."""
    since = (date.today() - timedelta(days=days)).isoformat()
    ids = [r[0] for r in db.execute("SELECT DISTINCT a.card_id FROM answer a JOIN card c ON c.id = a.card_id "
                                    "WHERE a.correct = 0 AND a.day >= ? AND c.source <> 'mistake' "
                                    "AND a.mode NOT IN ('calibrate', 'testout')", (since,))]
    if not ids:
        return []
    return [_card(r, "comeback") for r in db.execute(CARD_SQL + f"WHERE c.id IN ({','.join('?' * len(ids))})", ids)]


def lesson_finished(db, lesson_id):
    """The lesson's end: learned if every check card was right the last time it was asked today
    (a lesson without check cards: when you reach the end)."""
    checks = [r[0] for r in db.execute("SELECT id FROM card WHERE lesson_id = ? AND stage = 'check'", (lesson_id,))]
    ok = True
    for cid in checks:
        last = db.execute("SELECT correct FROM answer WHERE card_id = ? AND day = ? ORDER BY id DESC LIMIT 1",
                          (cid, date.today().isoformat())).fetchone()
        ok = ok and bool(last and last[0])
    if ok:
        db.execute("UPDATE lesson_state SET learned = COALESCE(learned, ?), placed = NULL WHERE lesson_id = ?",
                   (date.today().isoformat(), lesson_id))
    return ok


def plan(db):
    """Today's page: the counts, what is coming back, the weekly comeback, the next lessons, your levels."""
    t = today_counts(db)
    s = _db.settings(db)
    struggles = db.execute("SELECT COUNT(*) FROM v_struggle").fetchone()[0]
    struggles_due = db.execute("SELECT COUNT(*) FROM v_struggle WHERE due <= ?", (_now(),)).fetchone()[0]
    week = len(comeback(db))
    is_day = str((date.today().weekday() + 1) % 7) == str(s.get("comeback_day", "0"))
    _st, on, _w = _settings(db)
    subs = on or [r[0] for r in db.execute("SELECT id FROM subject WHERE id <> 'mine' ORDER BY sort")]
    nxt = []
    for sid in subs:
        f = frontier(db, sid)
        if f:
            nxt.append({k: f[0][k] for k in ("id", "title", "subject", "subject_id", "level", "minutes", "pos", "cards", "opened")})
    lv = [dict(r, **_level.describe(r["theta"], r["sd"])) for r in db.execute("SELECT * FROM v_skill WHERE kind = 'subject'")]
    return {**t, "struggles": struggles, "struggles_due": struggles_due, "comeback": week, "comeback_today": is_day,
            "next": nxt, "levels": lv}


def import_csv(db, text):
    """Flash cards from a CSV of front,back,topic. A topic that names a lesson (its id
    or title) puts the card there; any other topic becomes a lesson of your own."""
    rows = [r for r in csv.reader(io.StringIO(text)) if any(x.strip() for x in r)]
    if rows and [x.strip().lower() for x in rows[0][:3]] == ["front", "back", "topic"]:
        rows = rows[1:]
    lessons = {r["id"].lower(): r["id"] for r in db.execute("SELECT id, title FROM lesson")}
    lessons.update({r["title"].lower(): r["id"] for r in db.execute("SELECT id, title FROM lesson")})
    undo, made = [], 0
    for r in rows:
        if len(r) < 2 or not r[0].strip() or not r[1].strip():
            continue
        topic = (r[2] if len(r) > 2 else "").strip() or "Imported"
        lid = lessons.get(topic.lower())
        if not lid:
            lid = "mine.cards." + (re.sub(r"[^a-z0-9]+", "-", topic.lower()).strip("-") or "imported")
            if not db.execute("SELECT 1 FROM lesson WHERE id = ?", (lid,)).fetchone():
                db.execute("INSERT INTO lesson (id, unit_id, title, sort, source) VALUES (?, 'mine.cards', ?, 50, 'own')", (lid, topic))
                undo.append({"op": "remove", "table": "lesson", "pk": "id", "ids": [lid]})
            lessons[topic.lower()] = lid
        n = db.execute("SELECT COUNT(*) FROM card WHERE lesson_id = ?", (lid,)).fetchone()[0]
        cid = f"own/{lid}/{datetime.now():%Y%m%d%H%M%S}-{made}"
        db.execute("INSERT INTO card (id, lesson_id, sort, type, text, data, source) VALUES (?,?,?,?,?,?, 'own')",
                   (cid, lid, 1000 + n, "flash", r[0].strip()[:400],
                    json.dumps({"id": cid, "type": "flash", "front": r[0].strip(), "back": r[1].strip()}, ensure_ascii=False)))
        undo.insert(0, {"op": "remove", "table": "card", "pk": "id", "ids": [cid]})
        made += 1
    if not made:
        raise Err(400, "no cards found: each line needs a front and a back, then a topic if you like")
    _db.log_change(db, "import", "card", f"Imported {made} flash cards", detail={"undo": undo}, rows=made)
    db.commit()
    return {"ok": True, "added": made}


def before_write(db, name, row):
    """Your own cards through the generic API: the JSON is checked, the front text kept for search."""
    if name == "card":
        if row.get("source", "own") == "file":
            raise Err(400, "cards from the course files are edited in the files")
        if "data" in row:
            try:
                d = json.loads(row["data"]) if isinstance(row["data"], str) else row["data"]
            except ValueError:
                raise Err(400, "the card is not valid JSON")
            if d.get("type") not in TYPES:
                raise Err(400, "a card needs a type Learn knows")
            row["data"] = json.dumps(d, ensure_ascii=False)
            row["type"] = d["type"]
            row["text"] = front(d)


# --- Learn's own endpoints ---------------------------------------------------------------------

def route(db, method, p, query, body, ctx):
    g = lambda k, d=None: (query.get(k) or [d])[0]
    ids = lambda k: [x for x in (g(k) or "").split(",") if x]
    if p == ["feed"] and method == "GET":
        return 200, feed(db, min(int(g("n", 10)), 50), ids("exclude"), ids("subjects") or None, at=int(g("at", 0) or 0))
    if p == ["due"] and method == "GET":
        return 200, due_cards(db)
    if p == ["lesson"] and method == "GET":
        lid = g("id")
        les = db.execute("SELECT * FROM v_lesson WHERE id = ?", (lid,)).fetchone()
        if not les:
            raise Err(404, "no such lesson")
        full = db.execute("SELECT goals, summary, resources, sources FROM lesson WHERE id = ?", (lid,)).fetchone()
        pre_ids = json.loads(les["prereq"] or "[]")
        pre = [dict(r) for r in db.execute(
            f"SELECT id, title, mastered, asks, learned FROM v_lesson WHERE id IN ({','.join('?' * len(pre_ids))})", pre_ids)] if pre_ids else []
        k = db.execute("SELECT theta, sd FROM skill WHERE scope = ?", (les["unit_id"],)).fetchone() or \
            db.execute("SELECT theta, sd FROM skill WHERE scope = ?", (les["subject_id"],)).fetchone()
        notes = db.execute("SELECT notes FROM lesson_state WHERE lesson_id = ?", (lid,)).fetchone()
        return 200, {"lesson": {**dict(les), **{k_: (json.loads(full[k_]) if full[k_] and k_ != "summary" else full[k_])
                                                for k_ in ("goals", "summary", "resources", "sources")}},
                     "cards": lesson_cards(db, lid), "prereq": pre, "warmup": warmup(db, les),
                     "you": _level.describe(k["theta"], k["sd"]) if k else None, "notes": notes[0] if notes else None}
    if p[:2] == ["lesson", "place"] and method == "POST":
        lid = body.get("lesson_id")
        db.execute("INSERT INTO lesson_state (lesson_id, pos, seen, finished) VALUES (?, ?, ?, ?) "
                   "ON CONFLICT(lesson_id) DO UPDATE SET pos = excluded.pos, seen = excluded.seen, "
                   "finished = COALESCE(lesson_state.finished, excluded.finished)",
                   (lid, int(body.get("pos") or 0), _now(), _now() if body.get("finished") else None))
        learned = lesson_finished(db, lid) if body.get("finished") else None
        db.commit()
        return 200, {"ok": True, "learned": learned}
    if p == ["lesson", "notes"] and method == "POST":
        db.execute("INSERT INTO lesson_state (lesson_id, pos, notes) VALUES (?, 0, ?) "
                   "ON CONFLICT(lesson_id) DO UPDATE SET notes = excluded.notes", (body.get("lesson_id"), body.get("notes") or None))
        db.commit()
        return 200, {"ok": True}
    if p == ["formulas"] and method == "GET":
        return 200, formulas()
    if p == ["notes"] and method == "GET":
        sid = g("subject")
        rows = db.execute("SELECT l.id, l.title, l.summary, v.unit, v.unit_sort, v.sort, v.learned, v.opened, s.notes "
                          "FROM lesson l JOIN v_lesson v ON v.id = l.id LEFT JOIN lesson_state s ON s.lesson_id = l.id "
                          "WHERE v.subject_id = ? AND (l.summary IS NOT NULL OR (s.notes IS NOT NULL AND s.notes <> '')) "
                          "ORDER BY v.unit_sort, v.sort", (sid,)).fetchall()
        return 200, [dict(r) for r in rows]
    if p == ["practice"] and method == "GET":
        return 200, practice(db, ids("lessons"), min(int(g("n", 10)), 50))
    if p == ["answer"] and method == "POST":
        return 200, answer(db, body)
    if p == ["save"] and method == "POST":                       # swipe right: keep it for later
        db.execute("INSERT INTO card_state (card_id, saved, last_seen) VALUES (?, 1, ?) "
                   "ON CONFLICT(card_id) DO UPDATE SET saved = 1 - COALESCE(card_state.saved, 0)", (body.get("card_id"), _now()))
        db.commit()
        return 200, {"ok": True}
    if p == ["today"] and method == "GET":
        return 200, today_counts(db)
    if p == ["plan"] and method == "GET":
        return 200, plan(db)
    if p == ["levels"] and method == "GET":
        return 200, levels(db)
    if p == ["calibrate", "start"] and method == "POST":
        return 200, calibrate_start(db, body.get("subject"), body.get("said"))
    if p == ["calibrate", "next"] and method == "POST":
        return 200, calibrate_next(db, body.get("subject"), body.get("asked") or [])
    if p == ["checkpoint"] and method == "GET":
        return 200, checkpoint(db, g("unit"))
    if p == ["testout"] and method == "GET":
        return 200, testout(db, g("lesson"))
    if p == ["testout", "done"] and method == "POST":
        return 200, testout_done(db, body.get("lesson"), int(body.get("right") or 0), int(body.get("asked") or 0))
    if p == ["comeback"] and method == "GET":
        return 200, comeback(db)
    if p == ["report"] and method == "POST":
        if not db.execute("SELECT 1 FROM card WHERE id = ?", (body.get("card_id"),)).fetchone():
            raise Err(404, "no such card")
        db.execute("INSERT INTO report (card_id, note) VALUES (?, ?)", (body["card_id"], (body.get("note") or "").strip() or None))
        db.commit()
        return 200, {"ok": True}
    if p == ["rework"] and method == "GET":
        leeches = [dict(r) for r in db.execute("SELECT id, lesson_id, text, lesson, subject, lapses FROM v_card WHERE leech "
                                               "AND source <> 'mistake' ORDER BY lapses DESC")]
        reports = [dict(r) for r in db.execute("SELECT r.id, r.card_id, r.at, r.note, v.lesson_id, v.text, v.lesson, v.subject "
                                               "FROM report r LEFT JOIN v_card v ON v.id = r.card_id WHERE r.done = 0 ORDER BY r.at DESC")]
        return 200, {"leeches": leeches, "reports": reports}
    if p == ["import"] and method == "POST":
        return 200, import_csv(db, body.get("text") or "")
    if p == ["sketch"] and method == "GET":                      # your working on a card, from last time
        r = db.execute("SELECT * FROM sketch WHERE card_id = ?", (g("card"),)).fetchone()
        return 200, dict(r) if r else None
    if p == ["sketch"] and method == "POST":
        strokes, paper = body.get("strokes") or [], body.get("paper")
        text = json.dumps(strokes, separators=(",", ":"))
        if not isinstance(strokes, list) or len(text) > 4_000_000:
            raise Err(400, "that board is too big to keep")
        if not strokes:
            db.execute("DELETE FROM sketch WHERE card_id = ?", (body.get("card_id"),))
        else:
            db.execute("INSERT INTO sketch (card_id, strokes, paper, updated) VALUES (?, ?, ?, ?) ON CONFLICT(card_id) "
                       "DO UPDATE SET strokes = excluded.strokes, paper = excluded.paper, updated = excluded.updated",
                       (body.get("card_id"), text, paper if paper in ("plain", "squared", "graph") else None, _now()))
        db.commit()
        return 200, {"ok": True}
    return None
