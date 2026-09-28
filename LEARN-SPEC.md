# Spec: Learn 3 — lessons that stick, and knowing your level

A plan for the next version of Learn, for Will to agree before it is built.
It follows `SPEC.md` §7 (Learn as built in 2.0) and changes it where the
evidence says so. Read §1 for what the research says, §2–§6 for what gets
built, §8 for the order of work, §9 for my suggestions and §10 for the
decisions that are yours.

Contents
1. What the research says, and what Learn does with it
2. The lesson: one template, seven stages
3. Your level: calibration and proficiency
4. Struggles come back until they are solid
5. Scheduling: FSRS instead of SM-2
6. Changes to the data, the server and the screens
7. Content: which lessons, in what order, and how they are checked
8. Order of work
9. Suggestions, and where I disagree with the current design
10. Decisions for you
11. Sources

---

## 1. What the research says, and what Learn does with it

The effect sizes are from meta-analyses (g or d: 0.2 small, 0.5 medium,
0.8 large). Where the evidence is weak or mixed, it says so.

| Technique | Evidence | What Learn does |
|---|---|---|
| **Retrieval practice** (answering, not re-reading) | Classroom quizzing g = 0.50 over 222 studies; better with corrective feedback and when the quiz is like the real test (Yang et al. 2021). For **maths**, quizzing versus restudy is only g = 0.18 and not reliable (Murray et al. 2025). | Nearly every card asks something, with feedback. In maths, the questions are problems to solve, not facts to recall. |
| **Spacing** | Spaced beats massed: g = 0.28 in maths (Murray 2025) and g = 0.74 for spaced retrieval in general (Latimier et al. 2021). Expanding and even gaps do equally well (g = 0.03). The best gap is about 20% of how long you want to remember it for (a few weeks), falling to about 5% for a year (Cepeda et al. 2008). In real courses the gains are smaller: about +2.7% on exams (Bego et al. 2024). | FSRS schedules every card (§5). Each lesson comes back as a short check after about 1 day, 1 week and 3 weeks. |
| **Successive relearning** (get it right, come back, get it right again) | Very large gains. For example d = 1.82 after one relearning session, and a full grade on course exams. More than 3 relearning sessions were rarely worth it (Rawson & Dunlosky 2022). | Something is "solid" when you have got it right in 3 separate sessions. Struggles follow the same rule (§4). |
| **Interleaving** (mixing problem types) | Overall g = 0.42 and maths g = 0.34. It is *worse* for vocabulary (g = −0.39). It helps most when the types look alike (Brunmair & Richter 2019). | A "mixed practice" stage mixes problems that look alike, such as which rule, which formula, or which probe. Definitions and terms are not interleaved. |
| **Worked examples** | Maths g = 0.48 over 55 studies. Correct examples do best. Adding self-explanation prompts to examples made them *worse* (Barbieri et al. 2023). | Each skill runs example → faded example → your own problem. Examples have no "explain" prompts. |
| **Expertise reversal** (support helps beginners, hinders the able) | Support gives novices d = +0.51 and costs the knowledgeable d = −0.43, across 60 studies (Tetzlaff et al. 2025). | Your level (§3) decides the path. Above a lesson's level, you start with the problem and the example is there if you want it. |
| **Self-explanation** | Overall g = 0.55 (Bisra et al. 2018), though not on maths examples (above). | Used sparingly: one "why" card per lesson, after the problems. |
| **Prequestions** (asking before teaching) | g = 0.66 for the material asked about, about 0 for anything else. Feedback makes them stronger, and asking the same question again later helps most (King-Shepard et al. 2025; Pan & Carpenter 2023). | Each lesson opens with its key question. You guess, see the answer, and meet the same question again in the exit check. |
| **Try first** (productive failure) | Solving before instruction gives g = 0.36 (up to 0.58 when done properly) for *conceptual* understanding and transfer. It does not help procedures or younger learners (Sinha & Kapur 2021). | Concept lessons (for example why impedance mismatch reflects) can open with a problem to attempt. Procedure lessons do not. |
| **Confidence and hypercorrection** | Errors made with high confidence are corrected more readily, but they come back within a week unless retested (Butler et al. 2011). | An optional tap before seeing the answer: *sure / think so / guess*. A confident error is asked again later in the same session and the next day. A guess that happens to be right counts for less. |
| **Difficulty** | Practice at about 80–85% right is the usual target. Rosenshine used 80%, Math Academy targets about 80%, and there is a theoretical 85% (Wilson et al. 2019, a model rather than a human trial). | Learn aims for 75–90% right and adds easier or harder questions to stay there (§4). |
| **Mastery before moving on** | In tutoring systems the usual bar is 95% sure a skill is known. A 2025 study found 98% led to better results in the lessons that followed. | "Solid" means FSRS stability of 21 days or more *and* the 3-session rule. Prerequisites nudge rather than lock (§9). |
| **Small steps, daily and weekly review** | Rosenshine's principles (2012): review first, new material in small steps, many questions, show worked models, guide practice, check understanding, then independent practice and weekly or monthly review. | This is the lesson template (§2), plus a weekly "comeback" session (§4). |
| **Dual coding** | Words together with a relevant picture beat words alone (Mayer's multimedia principles). | Every teaching card has a figure, diagram or widget where one helps. |

This fits the way you already study: ask, then teach, then test, with
difficulty rising fast.

---

## 2. The lesson: one template, seven stages

A lesson takes 10–20 minutes on a phone or desktop and has 15–25 cards. Each
card has a **role**, and the role decides where it goes and what it does. A
small stage bar shows your progress:
*Warm-up · Try · Learn · Example · Practise · Mix · Check*.

| Stage | Cards | What happens | Why |
|---|---|---|---|
| 1. **Warm-up** | 2–3 | Due cards from this lesson's prerequisites, mixed. | Daily review first; it brings back what the lesson builds on. |
| 2. **Try** | 1–2 | The lesson's key question, asked before any teaching. A guess is fine, and the answer is shown. Concept lessons can use a problem to attempt instead. | Prequestion effect; productive failure for concepts only. |
| 3. **Learn** | 3–6 pairs | One idea per card (≤ 150 words, with a figure), each followed at once by a check question. | Small steps, then check understanding. |
| 4. **Example** | 2–3 | A full worked example, then a faded one (you do the last step or two), then the same kind of problem with new numbers. At or above the lesson's level: the problem first, and the example on request. | Worked examples, fading, expertise reversal. |
| 5. **Practise** | 3–5 | Your own problems (numeric templates, code, order, match), getting harder. Plus one "why" card. | Guided, then independent practice. |
| 6. **Mix** | 3–4 | Problems that look alike, from this lesson and earlier ones, e.g. "which of these needs the chain rule?" | Interleaving. |
| 7. **Check** | 3 | The key points cold, including the Try question again. A pass marks the lesson "learned" and starts its relearning. A miss sends those points to "Coming back" (§4). | Repeated prequestion; the success criterion. |

There are three kinds of lesson, each with its own template rules (checked by
`content.check.mjs`, §7):

- **Procedure** (differentiate, size a resistor, tune a loop). All seven stages; Example and Practise are the heart of it.
- **Concept** (why echoes happen, what slip is). Try uses a problem to attempt; Learn and Mix carry it; the Example stage is optional.
- **Facts** (data types, standards, terms). Short Learn cards, then flash, match and order cards. No Mix stage (interleaving hurts vocabulary).

**Relearning.** The Check cards come back as a 3-card mini-check after about
1 day, 7 days and 21 days (FSRS sets the exact days). Pass all three and the
lesson is **solid**.

**Test out.** "I know this" on a lesson asks 3–5 of its Check and Practise
questions at the lesson's level. Get them all right and the lesson is marked
learned, with its cards scheduled as reviews at a longer interval. It replaces
the "too easy" swipe as the way to skip.

---

## 3. Your level: calibration and proficiency

### 3.1 The scale

Every subject is measured on one ruler: the **UK qualification levels (RQF)**,
as a number with one decimal place.

| Level | Roughly |
|---|---|
| 2 | GCSE |
| 3 | A level, BTEC National, advanced apprenticeship |
| 4 | HNC, higher apprenticeship |
| 5 | HND, foundation degree |
| 6 | Bachelor's degree (BEng) |
| 7 | Master's (MEng, MSc) |

Every lesson has a level (A-level Maths: 3; the scan cycle: 3; vector control:
4.5; flaw sizing: 4). Every asking card has one too, which defaults to its
lesson's.

**"Your level" means the level at which you get about 8 in 10 right.** For
example: *"Maths: 3.6, likely 3.3–3.9. You get about 8 in 10 A-level questions
right; HNC-level calculus is next."*

### 3.2 The model

This is a standard one-parameter item response model, with a guessing floor
for multiple choice:

```
P(right) = g + (1 − g) / (1 + e^(−1.7 · (θ − b)))
  θ  your skill; b  the card's level; g  1/options for multiple choice, 0 for a typed answer
reported level = θ − 0.8          (where P(right) ≈ 0.8)
```

- **Estimating θ.** A grid of θ from 0 to 8 in steps of 0.05, with a prior and one likelihood term for each counted answer. The estimate is the posterior mean, and its **range** is ±1 posterior standard deviation.
  - It is about 40 lines of stdlib Python, gives an honest uncertainty, and is the same method for calibration and for everyday use.
  - *ponytail*: a grid, not an optimiser; fine at thousands of answers.
- **Older answers weigh less.** Their weight halves every 60 days, because you improve.
- **Scopes.** One estimate per **subject** and one per **unit**. A unit's prior is the subject's estimate (sd 1.0), so thin units lean on the subject. The unit estimates make the map of strengths and weak spots.
- **Which answers count.** Only *cold* answers:
  - calibration, Check, relearning checks, review and the first try in practice
  - not the check straight after a Learn card, which you have just read
  - a right answer you tapped as a *guess* counts as half

### 3.3 Calibration at the start of a course

The first time you open a subject, or when you press **Calibrate**, you get an
adaptive test.

- **Where it starts.** You say roughly where you are (GCSE … degree). That is the prior, with sd 1.5. It is only a starting point: you are not held to it, and the test moves fast.
- **The next question** comes from the subject's **calibration bank**. It is the one whose level is closest to your current θ, taking the units in turn so the whole course is covered.
  - Numeric templates draw new numbers every time, so the bank is never used up.
- **When it stops.** When the range is ±0.35 or narrower, or after **15 questions** (about 8–10 minutes). A quick version stops at 8.
- **Feedback.** Each answer shows right or wrong and the answer. It costs seconds, and a prequestion with feedback teaches (§1).
- **The result.**
  - Your level and range; strong and weak units.
  - Lessons well below your level are marked **probably known**. Their cards join review at a long interval, and one test-out makes them learned.
  - The first unlearned lesson at your level is marked **start here**.
- **The calibration bank** covers the *whole outline*, not only written lessons: 3 cards per outline lesson (§7). So placement works before every lesson exists.

### 3.4 During a course

- **Every cold answer** updates the subject and unit estimates.
- **Unit checkpoints.** At the end of each unit, a 10-question mixed check over that unit and earlier ones. It updates your level and shows the change: *"Pure maths: 3.4 → 3.7"*.
- **After a break of 30 days or more,** you are offered a short re-calibration (8 questions) before new lessons, as Math Academy does.
- **Recalibrate** is on every subject page at any time.

### 3.5 What your level changes

1. **The lesson path.** Below the lesson's level you get the full example first. At or above it, the problem comes first and the example is there on request (expertise reversal).
2. **Practice difficulty.** Questions are chosen so the predicted P(right) sits in 75–90%.
3. **What is next.** New lessons come from the **frontier**:
   - their prerequisites are learned
   - their level is no more than your level + 0.7
4. **Where you see it.** Today shows a strip with each subject's level and trend. Stats → **Levels** shows:
   - a chart of each subject's level (with its range) over time
   - the unit map
   - how often you are right when you say *sure* (confidence calibration)

---

## 4. Struggles come back until they are solid

**What counts as a struggle.**
- A card:
  - wrong twice in 30 days, or
  - wrong with *sure* tapped, or
  - an FSRS difficulty of 8 or more
- A topic (unit):
  - an estimate 0.5 or more below the subject's, or
  - recent accuracy under 70%

**How it comes back.**

1. **Nothing is ever finished.** Every asking card stays on the FSRS schedule. A struggle is simply due sooner.
2. **The feed takes a fixed share.**
   - Every 10 feed cards: about 5 due reviews, 2 struggles, 2 new (the frontier lesson, in order) and 1 mixed practice from a weak topic.
   - Right less than 70% of the time over the last 20: new cards stop and easier cards come in.
   - Right more than 92% of the time: harder practice and new cards come sooner.
3. **Confident errors** are asked again 3–5 cards later in the same session, then the next day. This is before they return (§1).
4. **Prerequisite repair.**
   - Miss a card whose lesson builds on another that is not solid (predicted recall below 0.8): a 3-card refresher from that lesson comes first, then the card again.
   - This is Math Academy's remedial review, on a smaller scale.
5. **Leeches** (4 misses or more):
   - The card is shown after its lesson's Learn card, not on its own.
   - It is listed under Stats → **Needs rework**, so the card can be rewritten, split or given a worked example. A card you keep missing is usually a badly made card.
6. **The rule for leaving.** A card or topic leaves "Coming back" only when it has been right in **3 separate sessions at least a day apart** (successive relearning).
7. **Weekly comeback.** Once a week (you choose the day), Today offers the week's misses in one 10-minute session (Rosenshine's weekly review).
8. **You can see it.** Review → **Coming back** lists every struggle with the date it is next due. Nothing leaves without the rule in 6.

---

## 5. Scheduling: FSRS instead of SM-2

SM-2 gives each card one "ease". In Learn's version, ease only ever goes down,
and a lapse starts the card again from 1 day. **FSRS-6** models each card with:
- **stability** S: the days until recall drops to 90%
- **difficulty** D: from 1 to 10
- **retrievability** R: the chance you recall it now

```
R(t, S) = (1 + f · t / S)^(−w20),   f = 0.9^(−1/w20) − 1      (R = 0.9 when t = S)
next interval for a desired retention r:  I = (S / f) · (r^(−1/w20) − 1)
```

- **The update rules** for S and D after a pass, a lapse or a same-day review are ported from the reference implementation (open-spaced-repetition, MIT licence) with its default 21 parameters. They are checked against its test values.
  - In the community benchmark FSRS predicts recall better than SM-2 for the large majority of users.
- **Desired retention** is 0.90, and it is a setting.
- **Moving an existing schedule over (once):**
  - S = the old interval (at least 0.5 days)
  - D from the old ease: 1.3 → 9, 2.5 → 5, 3.0 or more → 3
  - due dates are unchanged
  - the old columns stay, so nothing is lost
- **R** also gives "how solid" for lessons and units (mean R of their cards now), and drives the prerequisite check in §4.
- **Ratings.**
  - A right answer is Good.
  - A right answer tapped as a guess, or slow (over 3× your usual time on that card type), is Hard.
  - Wrong is Again.
  - Flash cards keep the four buttons.
- **Scheduling moves to the server.** It is computed in Python when an answer is saved, not in the browser. One place computes it, it is tested in Python, and the browser can no longer send a made-up schedule.
- *ponytail*: default parameters. Once you have about 1,000 reviews, a small stdlib optimiser can fit them to you. It is optional, and in a later phase.

---

## 6. Changes to the data, the server and the screens

**Migration `002_learn.sql`**

- It keeps every row: the tables that change are rebuilt with a copy, a check and a rename, as the Money migrations do.
- It is tested on a copy of a populated 2.2 `learn.db` before release.

| Table | Change |
|---|---|
| `card` | + `level REAL`, `role TEXT` (loaded from the content files every start, as now) |
| `lesson` | + `level REAL`, `kind TEXT` (procedure, concept or facts) |
| `card_state` | + `stability REAL`, `difficulty REAL`, `sessions_right INTEGER` (for the 3-session rule); filled from the SM-2 columns once |
| `answer` | rebuilt: `mode` also allows `calibrate`, `checkpoint`, `testout`, `relearn`; + `confidence INTEGER` (0 guess, 1 think so, 2 sure), `level REAL`, `cold INTEGER` |
| `lesson_state` | + `placed TEXT` (known, start), `learned TEXT` (date), `relearned INTEGER` |
| `skill` (new) | `scope` (subject or unit id) PK, `theta`, `se`, `n`, `updated` |
| `skill_log` (new) | `day`, `scope`, `theta`, `se`, `why`: the trend chart |
| settings | `desired_retention` 0.9, `target_right` 0.85, `confidence_taps` 1, `calibration_length` 15, `comeback_day` Sun |

**Views:**
- `v_struggle`: cards and units that match §4
- `v_frontier`: next lessons by prerequisites and level
- `v_level`: the latest estimate per scope, with its band

**Server** (`apps/learn/app.py`):
- `answer()` does four things: it schedules with FSRS, updates `skill`, keeps the struggle and relearn counters, and returns what to show next ("asked again in a moment" for a confident error).
- New routes:
  - `calibrate/next?subject=` and `calibrate/answer`
  - `checkpoint/<unit>`
  - `testout/<lesson>`
  - `levels`
  - `today` (the plan: due, struggles, next lesson, weekly comeback)
- The feed's mix (§4.2) is chosen by the server, as now.

**Screens:**
- **Today:** the levels strip, *Calibrate* on subjects that have not been placed, *Coming back (n)*, and the next lesson with its level and minutes.
- **Courses:** levels on subjects and lessons, *start here*, *probably known* with *Test out*, and solid or learned ticks.
- **The lesson player:** the stage bar; the confidence row under multiple-choice and numeric cards (it can be turned off); and an example shown collapsed when you are above the lesson's level.
- **Calibration:** full screen like the feed, one question at a time, and a result page.
- **Stats → Levels:** the charts, the unit map and confidence calibration. **Stats → Needs rework:** the leeches.
- **Review → Coming back:** the list, with next dates.

**Card changes** (all in `cards.js`; no new file types):
- `steps` gains `given: n`, which shows the first n steps and makes a faded example.
- Every card can have `role`, `level`, `figure` (an SVG file shown as an image, never inline) and `sources`.

---

## 7. Content: which lessons, in what order, and how they are checked

**Today:** 87 lessons outlined, 5 written, 99 cards.

**The plan:**
1. **Rewrite the 5 written lessons to the template** (about 20 cards each). They become the worked examples of the format.
2. **Write the calibration bank:** 3 cards per outline lesson, at that lesson's level, subject by subject (about 260 cards in all). It is written before most lessons, because placement needs the whole course.
3. **Write lessons in batches of 8–10,** following prerequisites, starred first. My proposed order (§10 asks you):
   - **Batch 1 (controls first):**
     - PLCs: data types and addressing, ladder basics, timers and counters, edge detection
     - Drives: induction motors and slip, V/f and vector control, encoders and resolvers, motion profiles
     - Electronics: Ohm's and Kirchhoff's laws
   - **Batch 2 (maths behind them):**
     - Maths: algebra and functions, trigonometry, exponentials and logarithms, integration
     - Physics: attenuation and decibels, capacitors
     - Electronics: transistors as switches, sensors and signals (4–20 mA, PT100, thermocouples)
   - **Batch 3 and on:** the rest of each unit, in outline order, plus the planned widgets as lessons need them. The widgets are:
     - DC circuit
     - RC charge and discharge
     - motion profile
     - tangent explorer
     - a ladder view for the PLC simulator

**Checks** (`tests/content.check.mjs`, extended). A lesson does not load unless:
- it has a `kind`, a `level` and `sources` (the books, standards or datasheets it was checked against)
- its stages follow its kind's template:
  - Try and Check are present
  - every Learn card is followed by a check
  - procedures have the example → faded → problem chain
  - facts lessons have no Mix stage
- every asking card has a level within ±1.5 of its lesson's
- numeric formulas pass 200 random draws (as now), and every template range gives a sensible answer
- each enabled subject's calibration bank covers every outline lesson with at least 3 cards spread across its levels

**Accuracy:**
- I write the content, and engineering facts must be right. Each lesson lists its sources.
- Numbers are worked by the formula engine, not typed.
- Every card has a small **Report a problem** link. It adds the card to Stats → Needs rework with your note, so a wrong card gets fixed rather than learned.

---

## 8. Order of work

Each phase is a release on its own, tested (§6) and zipped, with your
database moved over by migration.

| Phase | What | You get |
|---|---|---|
| **1. Engine** | Migration 002; FSRS on the server; confidence taps; `role` and `level` on cards; struggles, the 3-session rule, confident-error retests, prerequisite repair, Coming back, Needs rework, Report a problem. | Better scheduling at once; nothing you struggle with gets lost. |
| **2. Levels** | The θ model; calibration with its result page; checkpoints; the frontier, *start here*, *probably known*, test out; Stats → Levels; the Today strip. Calibration banks for the subjects you pick first. | "Roughly what level am I?", per subject and unit. |
| **3. Lessons** | The seven-stage player; faded examples; relearning mini-checks; the weekly comeback; figures; the 5 lessons rewritten; the content checks. | The new lesson format, end to end. |
| **4. Content** | Batches of 8–10 lessons, with their widgets and the rest of the calibration banks. | More lessons, in the order you choose. |
| **5. Tune** | After about a month of use: fit FSRS to your reviews, re-check levels against a fresh calibration, adjust the target success rate. | A schedule fitted to your memory. |

**Checks each phase adds** (in `tests/test_learn.py` unless stated):

- **FSRS** matches the reference implementation's test values.
- **The SM-2 → FSRS migration** keeps every card's due date.
- **A calibration simulation**, seeded and runnable:
  - 200 simulated learners with a true level between 2 and 6, answering from the model's own probabilities
  - 15 questions each
  - the median error must be under 0.35 levels, with 90% of learners within 0.6
- **A struggle simulation:** a card missed 3 times comes back until it has been right in 3 sessions, and never drops out of Coming back early.
- **The lesson template rules** (`content.check.mjs`).

---

## 9. Suggestions, and where I disagree with the current design

1. **Don't trust self-assessment for placement.** People misjudge their level both ways. So the self-rating is only the starting point of a short adaptive test, and the test moves fast. You asked not to be underestimated, and this starts where you say you are.
2. **One ruler for every subject (RQF levels).** Otherwise "level 3 in PLCs" and "level 3 in Maths" mean different things. RQF is recognisable, runs from GCSE to degree, and matches apprenticeship and HNC/HND levels in engineering.
3. **Replace "too easy" with test out.** Swiping a card away because it feels easy is exactly the illusion of knowing that retrieval practice exists to catch. Test out costs 30 seconds and settles it.
4. **Maths is solved, not recalled.** The maths evidence favours worked examples and spaced, mixed *problem* practice over flash cards (Murray 2025; Barbieri 2023). So maths lessons are mostly numeric templates with fresh numbers each time, and few flash cards.
5. **Prerequisites nudge, not lock** (as now). When a prerequisite is shaky, offer a 3-minute refresher before the lesson rather than blocking it. Locking punishes the able, which is expertise reversal again.
6. **Leeches mean a bad card, not a bad learner.** The fourth miss flags the card for rewriting, rather than showing it for the tenth time.
7. **Keep feed sessions ending well** (as §7.2 of `SPEC.md`). The goal ring, a summary every 20 cards, no streak shame. Struggles are a fixed share, not a flood.
8. **The server owns the schedule and the levels.** It is simpler, it is tested in Python, and nothing about your progress depends on what a browser sends.
9. **Calibration banks before full lessons.** Placement and levels across the whole outline work within the first content batch, and do not wait for 87 lessons.

---

## 10. Decisions for you

1. **Which subjects first?** My default is controls first: PLCs, then Drives, then Electronics, with Maths and Physics in batch 2 (§7).
2. **The level scale.** RQF (GCSE 2 … Master's 7) is my suggestion. The alternatives are a plain 1–10, or named bands (Beginner … Expert) with no numbers.
3. **Calibration length.** 15 questions (about 10 minutes, ±0.35) as standard. The alternatives are a quick 8 (about 5 minutes, ±0.5) or a thorough 25 (about 15 minutes, ±0.25).
4. **Confidence taps** (sure / think so / guess). On by default. They add one tap per question and power the confident-error retests and confidence calibration.

---

## 11. Sources

- Yang, Luo, Vadillo, Yu & Shanks (2021). Testing (quizzing) boosts classroom learning. *Psychological Bulletin*. https://pubmed.ncbi.nlm.nih.gov/33683913/
- Murray, Horner & Göbel (2025). A meta-analytic review of the effectiveness of spacing and retrieval practice for mathematics learning. *Educational Psychology Review*. https://link.springer.com/article/10.1007/s10648-025-10035-1
- Latimier, Peyre & Ramus (2021). A meta-analytic review of the benefit of spacing out retrieval practice episodes on retention. *Educational Psychology Review*. https://eric.ed.gov/?id=EJ1310148
- Cepeda, Vul, Rohrer, Wixted & Pashler (2008). Spacing effects in learning: a temporal ridgeline of optimal retention. *Psychological Science*. https://www.yorku.ca/ncepeda/publications/CVRWP2008.html
- Bego et al. (2024). Single-paper meta-analyses of the effects of spaced retrieval practice in nine introductory STEM courses. *International Journal of STEM Education*. https://link.springer.com/article/10.1186/s40594-024-00468-5
- Rawson & Dunlosky (2022). Successive relearning: an underexplored but potent technique. *Current Directions in Psychological Science*. https://journals.sagepub.com/doi/full/10.1177/09637214221100484
- Brunmair & Richter (2019). Similarity matters: a meta-analysis of interleaved learning and its moderators. *Psychological Bulletin*. https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf
- Barbieri, Miller-Cotto, Clerjuste & Chawla (2023). A meta-analysis of the worked examples effect on mathematics performance. *Educational Psychology Review*. https://link.springer.com/article/10.1007/s10648-023-09745-1
- Tetzlaff, Simonsmeier, Peters & Brod (2025). A cornerstone of adaptivity: a meta-analysis of the expertise reversal effect. *Learning and Instruction*. https://www.sciencedirect.com/science/article/pii/S0959475225000660
- Bisra, Liu, Nesbit, Salimi & Winne (2018). Inducing self-explanation: a meta-analysis. *Educational Psychology Review*. https://link.springer.com/article/10.1007/s10648-018-9434-x
- King-Shepard, Walker, Nokes-Malach, Carpenter & Fraundorf (2025). The effect of prequestions on learning: a multilevel meta-analysis. *Educational Psychology Review*. https://link.springer.com/article/10.1007/s10648-025-10075-7
- Pan & Carpenter (2023). Prequestioning and pretesting effects: a review. *Educational Psychology Review*. https://link.springer.com/article/10.1007/s10648-023-09814-5
- Sinha & Kapur (2021). When problem solving followed by instruction works: evidence for productive failure. *Review of Educational Research*. https://journals.sagepub.com/doi/10.3102/00346543211019105
- Butler, Fazio & Marsh (2011). The hypercorrection effect persists over a week, but high-confidence errors return. *Psychonomic Bulletin & Review*. https://link.springer.com/article/10.3758/s13423-011-0173-y
- Wilson, Shenhav, Straccia & Cohen (2019). The Eighty Five Percent Rule for optimal learning. *Nature Communications*. https://www.nature.com/articles/s41467-019-12552-4
- How much mastery is enough mastery? (EDM 2025). https://educationaldatamining.org/EDM2025/proceedings/2025.EDM.short-papers.4/index.html
- Rosenshine (2012). Principles of Instruction. *American Educator*. Summary: https://www.innerdrive.co.uk/blog/guide-rosenshine-10-principles/
- Pelánek (2016). Applications of the Elo rating system in adaptive educational systems. *Computers & Education*. https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf
- Math Academy: how the system works (diagnostic, knowledge frontier, remedial reviews). https://www.mathacademy.com/how-our-ai-works
- Skycak: spaced repetition in hierarchical knowledge (Fractional Implicit Repetition). https://www.justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/
- FSRS-6, the algorithm (Expertium). https://expertium.github.io/Algorithm.html
- UK qualification levels (RQF). https://www.gov.uk/what-different-qualification-levels-mean
