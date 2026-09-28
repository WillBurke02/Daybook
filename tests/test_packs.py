"""Courses from elsewhere:  python3 tests/test_packs.py

An Anki deck made here (basic, reversed and cloze notes, a picture, HTML and MathJax), a
Moodle XML quiz and a GIFT quiz of every kind Learn can ask, and a course pack exported and
imported again: each becomes a subject in the data folder, loads with the courses, keeps
where it came from, and goes again when removed. Nothing Learn cannot ask comes in.
"""
import base64
import io
import json
import os
import sqlite3
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from core import api, suite, db as _db               # noqa: E402
from apps.learn import packs                          # noqa: E402

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")


def anki_deck():
    tmp = tempfile.mkdtemp()
    path = os.path.join(tmp, "collection.anki2")
    db = sqlite3.connect(path)
    db.executescript("CREATE TABLE col (id INTEGER, models TEXT, decks TEXT);"
                     "CREATE TABLE notes (id INTEGER, mid INTEGER, flds TEXT, tags TEXT);"
                     "CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER, ord INTEGER);")
    models = {
        "1": {"name": "Basic (and reversed card)", "type": 0, "flds": [{"name": "Front"}, {"name": "Back"}],
              "tmpls": [{"qfmt": "{{Front}}", "afmt": "{{FrontSide}}<hr id=answer>{{Back}}"},
                        {"qfmt": "{{Back}}", "afmt": "{{FrontSide}}<hr id=answer>{{Front}}"}]},
        "2": {"name": "Cloze", "type": 1, "flds": [{"name": "Text"}, {"name": "Back Extra"}],
              "tmpls": [{"qfmt": "{{cloze:Text}}", "afmt": "{{cloze:Text}}<br>{{#Back Extra}}{{Back Extra}}{{/Back Extra}}"}]},
    }
    decks = {"10": {"name": "Electrical::Protection"}, "11": {"name": "Electrical::Motors"}}
    db.execute("INSERT INTO col VALUES (1, ?, ?)", (json.dumps(models), json.dumps(decks)))
    db.execute("INSERT INTO notes VALUES (100, 1, ?, '')",
               ("What does an <b>RCD</b> detect?<br><img src=\"rcd.png\">\x1fAn imbalance between line and neutral: current leaking to earth (costs $30)",))
    db.execute("INSERT INTO notes VALUES (101, 2, ?, '')",
               ("A 4-pole motor on 50 Hz has a synchronous speed of {{c1::1500::rpm}}; slip makes it run at about {{c2::1450}} rpm.\x1f\\(n_s = \\frac{120f}{p}\\)",))
    db.execute("INSERT INTO notes VALUES (102, 1, ?, '')", ("<div></div>\x1f",))      # empty: left out
    for cid, nid, did, o in ((1, 100, 10, 0), (2, 100, 10, 1), (3, 101, 11, 0), (4, 101, 11, 1), (5, 102, 10, 0)):
        db.execute("INSERT INTO cards VALUES (?, ?, ?, ?)", (cid, nid, did, o))
    db.commit()
    db.close()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.write(path, "collection.anki2")
        z.writestr("media", json.dumps({"0": "rcd.png"}))
        z.writestr("0", PNG)
    return buf.getvalue()


(subject, lessons), skipped = packs.from_anki(anki_deck(), "Electrical.apkg")
cards = {c["id"]: c for les in lessons for c in les["cards"]}
assert subject["id"] == "anki-electrical" and subject["title"] == "Electrical" and "licence" in subject["note"]
assert [l["title"] for l in lessons] == ["Motors", "Protection"], [l["title"] for l in lessons]
assert skipped == 1, skipped
rcd, rev = cards["n100-0"], cards["n100-1"]
assert rcd["front"] == "What does an **RCD** detect?" and rcd["img"][0].startswith("data:image/png;base64,"), rcd
assert rcd["back"].startswith("An imbalance") and "\\$30" in rcd["back"], "a dollar sign is not maths"
assert rev["front"].startswith("An imbalance") and rev["back"] == "What does an **RCD** detect?", rev
c1, c2 = cards["n101-0"], cards["n101-1"]
assert "[rpm]" in c1["front"] and "1450" in c1["front"] and "**1500**" in c1["back"], c1
assert "[…]" in c2["front"] and "**1450**" in c2["back"] and "$n_s = \\frac{120f}{p}$" in c2["back"], c2
try:
    packs.from_anki(b"PK\x05\x06" + b"\0" * 18, "empty.apkg")
    raise SystemExit("FAIL: an empty zip read as a deck")
except ValueError as e:
    assert "Anki" in str(e)
print("ok — Anki: basic, reversed and cloze cards, pictures, bold, maths, a dollar sign")

MOODLE = """<?xml version="1.0" encoding="UTF-8"?>
<quiz>
 <question type="category"><category><text>$course$/top/Safe isolation</text></category></question>
 <question type="multichoice"><name><text>Proving dead</text></name>
  <questiontext format="html"><text><![CDATA[<p>Which instrument does <b>GS38</b> guidance have you prove dead with?</p>]]></text></questiontext>
  <generalfeedback><text>A proprietary two-pole tester, proved on a known source before and after.</text></generalfeedback>
  <single>true</single>
  <answer fraction="0"><text>A multimeter on its volts range</text></answer>
  <answer fraction="100"><text>An approved two-pole voltage indicator</text><feedback><text>Right: made for it.</text></feedback></answer>
  <answer fraction="0"><text>A non-contact voltage pen</text></answer>
 </question>
 <question type="truefalse"><name><text>Lock-off</text></name>
  <questiontext><text>You keep the key to your own lock.</text></questiontext>
  <answer fraction="100"><text>true</text></answer><answer fraction="0"><text>false</text></answer>
 </question>
 <question type="numerical"><name><text>Ohm</text></name>
  <questiontext><text>24 V across 48 Ω: the current, in A?</text></questiontext>
  <answer fraction="100"><text>0.5</text><tolerance>0.01</tolerance></answer>
  <units><unit><multiplier>1</multiplier><unit_name>A</unit_name></unit></units>
 </question>
 <question type="matching"><name><text>Colours</text></name>
  <questiontext><text>Match the conductor to its colour.</text></questiontext>
  <subquestion><text>Protective earth</text><answer><text>Green and yellow</text></answer></subquestion>
  <subquestion><text>Neutral</text><answer><text>Blue</text></answer></subquestion>
  <subquestion><text>Line (single phase)</text><answer><text>Brown</text></answer></subquestion>
 </question>
 <question type="shortanswer"><name><text>Regs</text></name>
  <questiontext><text>Which regulations make isolation a legal duty at work?</text></questiontext>
  <answer fraction="100"><text>The Electricity at Work Regulations 1989</text></answer>
 </question>
 <question type="essay"><name><text>Essay</text></name><questiontext><text>Discuss.</text></questiontext></question>
</quiz>"""
(subject, lessons), skipped = packs.from_moodle(MOODLE, "isolation.xml")
got = {c["type"]: c for c in lessons[0]["cards"] if c.get("options") != ["True", "False"]}
assert lessons[0]["title"] == "Safe isolation" and skipped == 1
assert got["mcq"]["options"][got["mcq"]["answer"]] == "An approved two-pole voltage indicator" and "**GS38**" in got["mcq"]["q"]
assert "Right: made for it." in got["mcq"]["why"]
tf = [c for c in lessons[0]["cards"] if c["type"] == "mcq" and c["options"] == ["True", "False"]][0]
assert tf["answer"] == 0
assert got["numeric"]["answer"] == "0.5" and got["numeric"]["abs"] == 0.01 and got["numeric"]["unit"] == "A"
assert got["match"]["pairs"][1] == ["Neutral", "Blue"]
assert got["flash"]["back"] == "The Electricity at Work Regulations 1989"
print("ok — Moodle XML: multiple choice, true/false, numerical, matching, short answer; an essay left out")

GIFT = r"""// safe isolation, in GIFT
$CATEGORY: $course$/Isolation

::Tester:: Before and after proving dead you prove the tester on a {=known live source ~the circuit you isolated#No: that proves nothing ~a battery}.

::Keys:: You keep the key to your own lock. {T}

::Current:: 24 V across 48 Ω draws how many amps? {#0.5:0.01}

::Range:: A 4-pole motor's synchronous speed on 50 Hz, in rpm {#1499..1501}

::Colours:: Match the conductor to its colour. {
 =Protective earth -> Green and yellow
 =Neutral -> Blue
 =Line -> Brown
}

::Law:: Which regulations? {=Electricity at Work Regulations =EAWR}

::Essay:: Describe a lock-off. {}
"""
(subject, lessons), skipped = packs.from_gift(GIFT, "isolation.gift")
cs = lessons[0]["cards"]
assert lessons[0]["title"] == "Isolation" and skipped == 1 and len(cs) == 6, (skipped, cs)
mcq = cs[0]
assert mcq["options"][mcq["answer"]] == "known live source" and "_____" in mcq["q"] and mcq["q"].endswith(".")
assert cs[1]["options"] == ["True", "False"] and cs[1]["answer"] == 0
assert cs[2]["answer"] == "0.5" and cs[2]["abs"] == 0.01
assert cs[3]["answer"] == "1500.0" and cs[3]["abs"] == 1.0
assert cs[4]["pairs"][0] == ["Protective earth", "Green and yellow"]
assert cs[5]["type"] == "flash" and cs[5]["back"] == "Electricity at Work Regulations / EAWR"
print("ok — GIFT: multiple choice with feedback, true/false, numbers with tolerance and range, matching, short answer")

# === through Learn: import, load with the courses, download, remove =============================
tmp = tempfile.TemporaryDirectory()
suite.setup(os.path.join(tmp.name, "data"))
suite.open_all()
db = _db.connect(suite.path("learn"))
ctx = api.Ctx(True, suite.path("learn"), None, app=suite.SUITE.apps["learn"])
R = lambda m, path, body=None, q=None: api.route(db, m, [x for x in path.split("/") if x], q or {}, body, ctx)[1]
b64 = lambda b: "data:application/octet-stream;base64," + base64.b64encode(b).decode()
out = R("POST", "import/file", {"name": "Electrical.apkg", "data": b64(anki_deck())})
assert out == {"subject": "anki-electrical", "title": "Electrical", "lessons": 2, "cards": 4, "skipped": 1}, out
assert os.path.isfile(os.path.join(tmp.name, "data", "courses", "anki-electrical", "subject.json")), "a pack lives in the data folder"
R("POST", "import/file", {"name": "isolation.gift", "data": b64(GIFT.encode())})
R("POST", "import/file", {"name": "isolation.xml", "data": b64(MOODLE.encode())})
subjects = {r["id"]: r for r in R("GET", "v/v_subject")}
assert {"anki-electrical", "gift-isolation", "moodle-isolation"} <= set(subjects) and "electronics" in subjects
assert "Anki deck" in db.execute("SELECT note FROM subject WHERE id = 'anki-electrical'").fetchone()[0]
card = "anki-electrical.cards.protection/n100-0"
assert db.execute("SELECT type FROM card WHERE id = ?", (card,)).fetchone()[0] == "flash"
R("POST", "answer", {"card_id": card, "mode": "lesson", "correct": True, "rating": "good"})
out = R("POST", "import/file", {"name": "Electrical.apkg", "data": b64(anki_deck())})          # again: an update, not a copy
assert db.execute("SELECT COUNT(*) FROM subject WHERE id LIKE 'anki-%'").fetchone()[0] == 1
assert db.execute("SELECT reps FROM card_state WHERE card_id = ?", (card,)).fetchone()[0] == 1, "progress survives a re-import"
assert [p["id"] for p in R("GET", "packs")] == ["anki-electrical", "gift-isolation", "moodle-isolation"]

zipped = R("GET", "pack", q={"subject": ["electronics"]})
assert isinstance(zipped, api.File) and zipped.name == "electronics.zip"
try:
    R("POST", "import/file", {"name": "electronics.zip", "data": b64(zipped.data)})
    raise SystemExit("FAIL: a pack took a built-in subject's id")
except api.Err as e:
    assert "Learn's own" in e.msg
z_in, buf = zipfile.ZipFile(io.BytesIO(zipped.data)), io.BytesIO()
with zipfile.ZipFile(buf, "w") as z_out:                  # the same course, renamed: a pack of your own
    for n in z_in.namelist():
        data = z_in.read(n).decode()
        z_out.writestr(n.replace("electronics", "my-electronics"), data.replace('"electronics', '"my-electronics'))
out = R("POST", "import/file", {"name": "my-electronics.zip", "data": b64(buf.getvalue())})
assert out["subject"] == "my-electronics" and out["cards"] > 20, out
bad = io.BytesIO()
with zipfile.ZipFile(bad, "w") as z:
    z.writestr("x/subject.json", json.dumps({"id": "x", "title": "X", "units": [{"id": "x.u", "title": "U", "lessons": [{"id": "x.u.l", "title": "L"}]}]}))
    z.writestr("x/u/l.json", json.dumps({"id": "x.u.l", "cards": [{"id": "a", "type": "hologram"}]}))
try:
    R("POST", "import/file", {"name": "x.zip", "data": b64(bad.getvalue())})
    raise SystemExit("FAIL: a broken pack was taken")
except api.Err as e:
    assert "hologram" in e.msg or "type" in e.msg, e.msg
R("DELETE", "packs/gift-isolation")
assert "gift-isolation" not in {r["id"] for r in R("GET", "v/v_subject")}
try:
    R("DELETE", "packs/electronics")
    raise SystemExit("FAIL: removed a built-in course")
except api.Err:
    pass
print("ok — through Learn: import, load with the courses, re-import keeps progress, pack out and in, broken refused, remove")
print("all pack checks passed")
