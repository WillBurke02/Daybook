"""One runnable check for Learn:  python3 tests/test_learn.py

The course files load into learn.db and reload without losing progress; the feed
brings due reviews, then new cards in course order, then practice, by subject;
answers are recorded and a wrong one becomes a flash card; your own cards and the
CSV import; the Home card, the counts and the calendar reminder.
"""
import json
import os
import random
import sys
import tempfile
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from core import db as _db, api                      # noqa: E402
from apps.learn import app as learn                  # noqa: E402

tmp = tempfile.TemporaryDirectory()
DB = os.path.join(tmp.name, "learn.db")
db = _db.open_db(DB, learn, quiet=True)
CTX = api.Ctx(True, DB, os.path.join(tmp.name, "bk"), app=learn)
R = lambda m, path, body=None, q=None: api.route(db, m, [x for x in path.split("/") if x], q or {}, body, CTX)[1]
one = lambda sql, *a: db.execute(sql, a).fetchone()
now = lambda: datetime.now().strftime("%Y-%m-%d %H:%M")

# === the files load: the outline, the written lessons, every card ===================
subjects, units, lessons, cards = learn.read_content()
assert one("SELECT COUNT(*) n FROM lesson WHERE source='file'")["n"] == len(lessons) >= 80
assert one("SELECT COUNT(*) n FROM card WHERE source='file'")["n"] == len(cards) >= 90
assert {"maths", "physics", "electronics", "plc", "drives", "electrical", "practice"} <= {s["id"] for s in subjects}
pe = "physics.ut.pulse-echo"
assert one("SELECT data FROM card WHERE id=?", f"{pe}/thickness-from-time"), "a card's id is lesson/card"
les = R("GET", "lesson", q={"id": [pe]})
assert les["lesson"]["title"] == "Pulse-echo and time of flight" and les["prereq"][0]["id"] == "physics.waves.progressive"
assert [c["id"].split("/")[1] for c in les["cards"][:2]] == ["echo-between", "idea"], "cards in file order"
assert les["cards"][1]["card"]["type"] == "concept" and les["cards"][0]["state"] is None

# === the feed: new cards in course order, subjects taking turns ======================
rng = random.Random(3)
f = learn.feed(db, 6, subjects=["physics"], rng=rng)
assert [c["id"] for c in f[:2]] == [f"{pe}/echo-between", f"{pe}/idea"], "the first physics lesson with cards, from the top"
assert all(c["why"] == "new" for c in f)
mixed = learn.feed(db, 40, rng=rng)
with_cards = {c["lesson_id"].split(".")[0] for c in cards}
assert {c["subject_id"] for c in mixed} == with_cards, "every subject with cards takes a turn"
assert len({c["id"] for c in mixed}) == len(mixed), "no card twice in one batch"
ex = learn.feed(db, 3, exclude=[f"{pe}/echo-between"], subjects=["physics"], rng=rng)
assert ex[0]["id"] == f"{pe}/idea", "the ones already on screen are left out"
db.execute("UPDATE setting SET value=? WHERE key='subjects_on'", (json.dumps(["plc"]),))
assert {c["subject_id"] for c in learn.feed(db, 10, rng=rng)} == {"plc"}, "only the subjects that are on"
db.execute("UPDATE setting SET value='' WHERE key='subjects_on'")
db.execute("UPDATE setting SET value=? WHERE key='weights'", (json.dumps({s: 0 for s in with_cards - {"plc"}}),))
assert {c["subject_id"] for c in learn.feed(db, 10, rng=rng)} == {"plc"}, "a weight of 0 gives way while any other subject has cards"
db.execute("UPDATE setting SET value='{}' WHERE key='weights'")
db.commit()

# === answers: the server schedules (FSRS), a wrong one makes a flash card ===========
card = f"{pe}/why-half"
out = R("POST", "answer", {"card_id": card, "mode": "lesson", "correct": True, "ms": 4000})
assert out["mistake"] is None and out["today"]["cards"] == 1 and out["next"] == "Next in 2 days"
row = one("SELECT * FROM card_state WHERE card_id=?", card)
assert (row["interval_days"], row["reps"], row["last_rating"], row["phase"]) == (2, 1, "good", "review")
assert abs(row["stability"] - 2.3065) < 1e-4 and row["due"] == (date.today() + timedelta(days=2)).isoformat() + " 00:00", \
    "a review in days is due from the start of that day"
wrong = f"{pe}/echo-between"
out = R("POST", "answer", {"card_id": wrong, "mode": "feed", "correct": False,
                           "mistake": {"front": "An echo half-way?", "back": "A flaw at about 20 mm"}})
assert out["mistake"] == f"mistake/{wrong}" and out["next"] == "Back in ten minutes" and not out["struggle"], \
    "a first miss while learning is learning, not a struggle"
m = one("SELECT * FROM v_card WHERE id=?", out["mistake"])
assert m["source"] == "mistake" and m["type"] == "flash" and m["lesson_id"] == pe and m["due"] <= now(), "due at once, in the same lesson"
R("POST", "answer", {"card_id": wrong, "mode": "feed", "correct": False, "mistake": {"front": "again", "back": "b"}})
assert one("SELECT COUNT(*) n FROM card WHERE source='mistake'")["n"] == 1, "one flash card per card, however often it is missed"
due = [c["id"] for c in R("GET", "due")]
assert f"mistake/{wrong}" in due and wrong not in due and card not in due, "a missed card is back in ten minutes, not at once"
assert all(c["source"] != "mistake" for c in [one("SELECT source FROM card WHERE id=?", x["id"]) for x in R("GET", "lesson", q={"id": [pe]})["cards"]]), \
    "the lesson shows its own cards, not the flash cards made from mistakes"
R("POST", "answer", {"card_id": f"{pe}/idea", "mode": "lesson", "correct": None})
seen = one("SELECT * FROM card_state WHERE card_id=?", f"{pe}/idea")
assert seen["last_rating"] == "seen" and seen["due"] is None, "a concept is seen, not scheduled"
nxt = learn.feed(db, 3, subjects=["physics"], rng=rng)
assert nxt[0]["why"] == "review" and nxt[0]["id"] == f"mistake/{wrong}", "due reviews come first"
assert all(c["id"] not in (f"{pe}/idea", card) for c in nxt), "answered and seen cards are no longer new"
assert R("GET", "today")["cards"] == 4
a = one("SELECT * FROM answer WHERE card_id=? ORDER BY id LIMIT 1", card)
assert (a["mode"], a["correct"], a["rating"], a["ms"], a["subject_id"]) == ("lesson", 1, "good", 4000, "physics")
try:
    R("POST", "answer", {"card_id": "nope/nothing"})
    raise SystemExit("FAIL: answered a card that does not exist")
except api.Err:
    pass

# === practice: numeric cards only, from the lessons picked ===========================
p = learn.practice(db, [pe], 12, rng=rng)
assert len(p) == 12 and all(c["type"] == "numeric" and c["lesson_id"] == pe for c in p)
assert learn.practice(db, [], 5) == [] and learn.practice(db, ["maths.pure.proof"], 5) == []

# === saved for later: a toggle =======================================================
R("POST", "save", {"card_id": card})
assert one("SELECT saved FROM v_card WHERE id=?", card)["saved"] == 1
R("POST", "save", {"card_id": card})
assert one("SELECT saved FROM v_card WHERE id=?", card)["saved"] == 0

# === where you are in a lesson, for Continue ==========================================
R("POST", "lesson/place", {"lesson_id": pe, "pos": 5})
assert one("SELECT pos, opened, finished FROM v_lesson WHERE id=?", pe)["pos"] == 5
assert "Continue: Pulse-echo" in json.dumps(R("GET", "home"))
R("POST", "lesson/place", {"lesson_id": pe, "pos": 24, "finished": True})
R("POST", "lesson/place", {"lesson_id": pe, "pos": 0})
assert one("SELECT finished FROM v_lesson WHERE id=?", pe)["finished"], "going back over a finished lesson keeps it finished"

# === reloading the files keeps every bit of progress ==================================
before = [tuple(r) for r in db.execute("SELECT * FROM card_state ORDER BY card_id")]
db.close()
db = _db.open_db(DB, learn, quiet=True)
assert [tuple(r) for r in db.execute("SELECT * FROM card_state ORDER BY card_id")] == before
assert one("SELECT COUNT(*) n FROM card WHERE source='mistake'")["n"] == 1, "flash cards from mistakes survive a reload"
assert one("SELECT COUNT(*) n FROM card WHERE source='file'")["n"] == len(cards)

# === your own cards: through the generic API, checked; the course files are not editable here ===
R("POST", "t/lesson", {"id": "mine.cards.site", "unit_id": "mine.cards", "title": "Site notes", "source": "own"})
R("POST", "t/card", {"id": "own/mine.cards.site/1", "lesson_id": "mine.cards.site", "source": "own",
                     "data": json.dumps({"type": "flash", "front": "Torque for M12 8.8?", "back": "About 80 Nm (check the sheet)"})})
mine = one("SELECT * FROM v_card WHERE id='own/mine.cards.site/1'")
assert (mine["type"], mine["text"], mine["subject_id"]) == ("flash", "Torque for M12 8.8?", "mine")
for bad in ({"id": "own/x", "lesson_id": "mine.cards.site", "data": "{not json"},
            {"id": "own/y", "lesson_id": "mine.cards.site", "data": json.dumps({"type": "essay"})},
            {"id": f"{pe}/idea", "source": "file", "data": json.dumps({"type": "flash", "front": "a", "back": "b"})}):
    try:
        R("POST", "t/card", bad)
        raise SystemExit(f"FAIL: accepted {bad}")
    except api.Err:
        db.rollback()
assert any(c["subject_id"] == "mine" for c in learn.feed(db, 50, rng=rng)), "your own cards join the feed"

# === the CSV import: header skipped, a topic naming a lesson files it there, anything else makes one ===
got = learn.import_csv(db, "front,back,topic\nWhat is Z?,Density times velocity,Acoustic impedance and reflection\n"
                           "\"Ohm's law, as a formula?\",V = IR,Electricity basics\n,skipped,x\nBlank back,,x\n")
assert got["added"] == 2
assert one("SELECT lesson_id FROM card WHERE text='What is Z?'")["lesson_id"] == "physics.ut.impedance"
new_lesson = one("SELECT l.* FROM card c JOIN lesson l ON l.id = c.lesson_id WHERE c.text = 'Ohm''s law, as a formula?'")
assert (new_lesson["id"], new_lesson["title"], new_lesson["source"]) == ("mine.cards.electricity-basics", "Electricity basics", "own")
R("POST", "undo", {})
assert one("SELECT COUNT(*) n FROM card WHERE text IN ('What is Z?', 'Ohm''s law, as a formula?')")["n"] == 0, "one undo takes the import back"
assert not one("SELECT 1 FROM lesson WHERE id='mine.cards.electricity-basics'")
try:
    learn.import_csv(db, "front,back,topic\n")
    raise SystemExit("FAIL: imported nothing without saying so")
except api.Err:
    pass

# === search finds cards and lessons ================================================
hits = {g["kind"]: g["rows"] for g in R("GET", "search", q={"q": ["impedance"]})}
assert any(r["id"] == "physics.ut.impedance" for r in hits["lesson"]) and hits["card"]

# === counts, streak, Home and the calendar ==========================================
t = learn.today_counts(db)
assert t["goal_kind"] == "cards" and t["goal"] == 20 and t["cards"] == 4 and t["streak"] == 1
db.execute("INSERT INTO answer (card_id, day) VALUES ('x', ?), ('x', ?)", ((date.today() - timedelta(days=1)).isoformat(),
                                                                           (date.today() - timedelta(days=3)).isoformat()))
assert learn.streak(db) == 2, "today and yesterday; the day before is empty, so the run stops"
db.execute("INSERT INTO study (day, subject_id, minutes) VALUES (?, 'physics', 25)", (date.today().isoformat(),))
db.execute("UPDATE setting SET value='minutes' WHERE key='goal_kind'")
t = learn.today_counts(db)
assert t["done"] >= 25 and t["minutes"] >= 25, "the study timer counts towards a goal in minutes"
h = learn.home(db)
assert h["ring"]["label"] == "minutes today" and h["figures"][0]["label"] == "Due"
assert learn.calendar(db, "2026-01-01", "2030-12-31") == [], "no reminder unless switched on"
db.execute("UPDATE setting SET value='1' WHERE key='review_reminder'")
ev = learn.calendar(db, date.today().isoformat(), (date.today() + timedelta(days=6)).isoformat())
assert len(ev) == 7 and ev[0]["title"].startswith("Learn: review (") and ev[1]["title"] == "Learn: review"
db.commit()

print("ok — learn: files, feed, answers and mistakes, practice, reloads, own cards, CSV import, search, Home, calendar")

# === FSRS: the same numbers as the reference library (py-fsrs 6.3.2, one 10-minute step, no fuzz) ===
from apps.learn import fsrs, level as lvl      # noqa: E402
VECTORS = [   # rating, stability, difficulty, days to the next review, each answer given when the last one fell due
    [("good", 2.3065, 2.1181, 2), ("good", 10.9643, 2.1112, 11), ("good", 46.2802, 2.1043, 46), ("good", 162.8622, 2.0975, 163)],
    [("again", 0.212, 6.4133, 0), ("good", 0.2467, 6.4021, 1), ("good", 2.0215, 6.3909, 2), ("again", 0.526, 8.799, 0),
     ("good", 0.5765, 8.7854, 1), ("good", 1.6658, 8.7718, 2)],
    [("easy", 8.2956, 1.0, 8), ("easy", 65.6242, 1.0, 66), ("hard", 171.9588, 4.0106, 172), ("good", 446.6946, 4.0018, 447)],
    [("hard", 1.2931, 5.1122, 0), ("hard", 1.2931, 6.7405, 0), ("good", 1.3359, 6.7289, 1), ("again", 0.3771, 8.9101, 0),
     ("again", 0.1427, 9.627, 0), ("good", 0.1705, 9.6126, 1), ("easy", 1.0412, 9.4683, 1)],
]
for seq in VECTORS:
    t, c = datetime(2026, 1, 1, 9, 0), None
    for rating, s_, d_, days in seq:
        c = fsrs.review(c, rating, t)
        assert abs(c["stability"] - s_) < 1e-4 and abs(c["difficulty"] - d_) < 1e-4 and c["days"] == days, (seq, rating, c)
        t = c["due"]
assert abs(fsrs.retrievability(10, 10) - 0.9) < 1e-9, "R is 90% when the days equal the stability"
assert fsrs.interval(10, 0.9) == 10 and fsrs.interval(10, 0.8) > 10
print("ok — FSRS matches the reference")

# === the move from SM-2: a 2.x database keeps every answer, and its cards keep their dates ===
import shutil, types      # noqa: E402,E401
old_dir = os.path.join(tmp.name, "mig1")
os.makedirs(old_dir)
shutil.copy(os.path.join(os.path.dirname(learn.MIGRATIONS), "migrations", "001_learn.sql"), old_dir)
old_app = types.SimpleNamespace(NAME="learn", MIGRATIONS=old_dir, VIEWS=None)
ODB = os.path.join(tmp.name, "old.db")
odb = _db.connect(ODB)
_db.migrate(odb, old_app, log=lambda *_: None)
odb.execute("INSERT INTO card_state (card_id, due, interval_days, ease, reps, lapses, last_rating, last_seen) "
            "VALUES ('physics.ut.pulse-echo/why-half', '2026-10-01 00:00', 12, 1.9, 4, 1, 'good', '2026-09-19 20:00')")
odb.execute("INSERT INTO answer (card_id, mode, correct, rating, ms) VALUES ('physics.ut.pulse-echo/why-half', 'review', 1, 'good', 3000)")
odb.commit()
odb.close()
odb = _db.open_db(ODB, learn, quiet=True)
st = odb.execute("SELECT * FROM card_state").fetchone()
assert (st["due"], st["stability"], st["phase"]) == ("2026-10-01 00:00", 12, "review") and abs(st["difficulty"] - 7.0) < 1e-9
assert odb.execute("SELECT COUNT(*) FROM answer WHERE mode='review' AND ms=3000").fetchone()[0] == 1, "answers kept"
odb.execute("INSERT INTO answer (card_id, mode, confidence) VALUES ('x', 'calibrate', 2)")      # the new ways in are allowed
odb.close()
print("ok — SM-2 schedules and old answers move over")

# === struggles: missed after learning, back until right on three separate days ===
def aged(cid, days):
    """Pretend the card's last review was some days ago."""
    past = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M")
    db.execute("UPDATE card_state SET last_review = ?, last_right_day = CASE WHEN last_right_day IS NULL THEN NULL ELSE ? END, "
               "due = ? WHERE card_id = ?", (past, past[:10], past, cid))
    db.commit()
sc = f"{pe}/thickness-from-time"
R("POST", "answer", {"card_id": sc, "mode": "lesson", "correct": True})
aged(sc, 3)
out = R("POST", "answer", {"card_id": sc, "mode": "review", "correct": False})
assert out["struggle"] and one("SELECT struggle, right_days, lapses FROM card_state WHERE card_id=?", sc)[0] == 1
assert any(r["id"] == sc for r in R("GET", "v/v_struggle")), "on the Coming back list"
for k in range(3):
    aged(sc, 1)
    R("POST", "answer", {"card_id": sc, "mode": "review", "correct": True})
    R("POST", "answer", {"card_id": sc, "mode": "practice", "correct": True})     # twice in a day counts once
    assert one("SELECT struggle FROM card_state WHERE card_id=?", sc)[0] == (1 if k < 2 else 0), k
print("ok — struggles come back until right on three days")

# === a confident mistake is asked again; a right guess counts for less; practice does not push reviews out ===
cm = f"{pe}/flaw-depth-al"
out = R("POST", "answer", {"card_id": cm, "mode": "feed", "correct": False, "confidence": 2})
assert out["retest"] and one("SELECT struggle FROM card_state WHERE card_id=?", cm)[0] == 1, "sure and wrong: a struggle at once"
g = f"{pe}/repeats"
R("POST", "answer", {"card_id": g, "mode": "feed", "correct": True, "confidence": 0})
assert one("SELECT last_rating FROM card_state WHERE card_id=?", g)[0] == "hard"
before = one("SELECT due, stability FROM card_state WHERE card_id=?", card)
R("POST", "answer", {"card_id": card, "mode": "practice", "correct": True})
assert tuple(one("SELECT due, stability FROM card_state WHERE card_id=?", card)) == tuple(before), "not due: a right answer leaves it"
print("ok — confident mistakes, guesses, practice")

# === your level: the estimate finds a simulated learner's level in 15 questions ===
rng2 = random.Random(11)
errs = []
for _ in range(200):
    true = rng2.uniform(2, 7)
    ans, theta, sd = [], 4.8, 2.0
    for q in range(15):
        b = min(max(theta + rng2.uniform(-0.3, 0.3), 1), 9)
        floor = 0.25 if rng2.random() < 0.3 else 0.0
        ans.append((b, floor, int(rng2.random() < lvl.p_right(true, b, floor)), None, 1.0))
        theta, sd = lvl.estimate(ans, 4.8, 2.0)
        if q >= 4 and sd <= 0.35:
            break
    errs.append(abs(theta - true))
errs.sort()
assert errs[100] < 0.35 and errs[180] < 0.65, (errs[100], errs[180])
assert lvl.describe(4.9, 0.3)["stage"] == 4 and lvl.describe(4.9, 0.3)["rqf"].startswith("Level 2"), "8 in 10 at stage 4: GCSE"
assert lvl.stage_of(0.4)[0] == 1 and lvl.stage_of(12)[0] == 9, "the scale ends at 1 and 9"
js = open(os.path.join(os.path.dirname(HERE), "apps/learn/web/views/levels.js"), encoding="utf-8").read()
import re as _re      # noqa: E402
PAT = r"\[(\d), '([^']+)', (?:'([^']+)'|\"([^\"]+)\")\]"
assert [(n, name, a or b) for n, name, a, b in _re.findall(PAT, js)] == [(str(n), name, rqf) for n, name, _a, rqf in lvl.STAGES], \
    "the stages in levels.js match level.py"
print(f"ok — levels: median error {errs[100]:.2f} stages, 90% within {errs[180]:.2f}")

# === calibration end to end: start where you say, answer, stop, and be placed ===
cal_sub = "physics"
R("POST", "calibrate/start", {"subject": cal_sub, "said": 5})
asked = []
for _ in range(20):
    nx = R("POST", "calibrate/next", {"subject": cal_sub, "asked": asked})
    if nx["done"]:
        break
    it = nx["item"]
    asked.append(it["id"])
    ok = it["level"] <= 5.3                                   # someone at about stage 5
    R("POST", "answer", {"card_id": it["id"], "mode": "calibrate", "correct": ok, "confidence": 1})
res = nx["result"] if nx["done"] else R("POST", "calibrate/next", {"subject": cal_sub, "asked": asked * 20})["result"]
assert 3.5 < res["subject"]["level"] < 6.5, res["subject"]
assert not one("SELECT COUNT(*) n FROM card_state WHERE card_id IN (%s) AND stability IS NOT NULL AND last_review >= ?"
               % ",".join("?" * len(asked)), *asked, now()[:10] + " 99")["n"], "calibration does not schedule"
assert one("SELECT placed FROM skill WHERE scope=?", cal_sub)["placed"]
lv_all = R("GET", "levels")
assert any(s_["scope"] == cal_sub and s_["kind"] == "subject" for s_ in lv_all["skills"]) and len(lv_all["stages"]) == 9
print("ok — calibration places you")

# === test out, and a lesson learned by its check ===
to = R("GET", "testout", q={"lesson": ["plc.basics.scan-cycle"]})
assert 1 <= len(to) <= 4 and all(c["lesson_id"] == "plc.basics.scan-cycle" for c in to)
assert not R("POST", "testout/done", {"lesson": "plc.basics.scan-cycle", "right": len(to) - 1, "asked": len(to)})["passed"]
assert R("POST", "testout/done", {"lesson": "plc.basics.scan-cycle", "right": len(to), "asked": len(to)})["passed"]
ls = one("SELECT * FROM v_lesson WHERE id='plc.basics.scan-cycle'")
assert ls["learned"] and one("SELECT COUNT(*) n FROM v_card WHERE lesson_id='plc.basics.scan-cycle' AND asks AND due IS NULL "
                            "AND source='file' AND COALESCE(stage,'') <> 'calibrate'")["n"] == 0, "every card starts as a review"
assert all(f["id"] != "plc.basics.scan-cycle" for f in learn.frontier(db, "plc")), "a learned lesson is off the frontier"
print("ok — test out")

# === reports and the rework list ===
R("POST", "report", {"card_id": card, "note": "the answer looks wrong"})
rw = R("GET", "rework")
assert rw["reports"][0]["card_id"] == card and rw["reports"][0]["note"] == "the answer looks wrong"
print("ok — report a problem")


# === your working on the whiteboard, kept per card ===============================================
board = [{"c": 0, "w": 2.5, "p": [[10, 20, 0.5], [30.5, 40, 0.7]]}]
assert R("GET", "sketch", q={"card": [card]}) is None
R("POST", "sketch", {"card_id": card, "strokes": board, "paper": "graph"})
got = R("GET", "sketch", q={"card": [card]})
assert json.loads(got["strokes"]) == board and got["paper"] == "graph" and got["updated"]
R("POST", "sketch", {"card_id": card, "strokes": board, "paper": "wallpaper"})
assert R("GET", "sketch", q={"card": [card]})["paper"] is None, "only the papers there are"
try:
    R("POST", "sketch", {"card_id": card, "strokes": [{"p": [[1, 2, 3]] * 600000}]})
    raise SystemExit("FAIL: kept a board far too big")
except api.Err as e:
    assert e.code == 400
R("POST", "sketch", {"card_id": card, "strokes": []})
assert R("GET", "sketch", q={"card": [card]}) is None, "a cleared board is forgotten"
print("ok — whiteboard working kept per card")

# === explain the step is rated by you; spot the mistake is marked, and a guess is 1 in so many lines ======
ex, sp = "electronics.dc.ohm-kirchhoff/explain-divider", "electronics.dc.ohm-kirchhoff/spot-parallel"
R("POST", "answer", {"card_id": ex, "mode": "lesson", "correct": True, "rating": "hard"})
assert db.execute("SELECT last_rating FROM card_state WHERE card_id = ?", (ex,)).fetchone()[0] == "hard"
R("POST", "answer", {"card_id": sp, "mode": "lesson", "correct": False})
assert tuple(db.execute("SELECT floor, correct FROM answer WHERE card_id = ? ORDER BY id DESC", (sp,)).fetchone()) == (0.25, 0)
les = R("GET", "lesson", q={"id": ["electronics.dc.ohm-kirchhoff"]})["lesson"]
assert les["bench"] and les["bench"][0]["check"], "the lesson carries its bench task"
print("ok — explain (self-rated), spot the mistake (marked), bench tasks")
