# SkillTree: making Learn a map you can see yourself climbing

Branch `SkillTree`. This is the plan the branch implements; what is deliberately
left out is at the end.

## What is wrong now

Learn is a list: subject, unit, lesson, a status word. It is correct and it is
flat. Nothing says *where this is going*, why a lesson matters, what it opens up,
or what to do next after the feed. The data to do better already exists:

- 236 lessons, 125 with explicit `prereq` links, every one with a `level` (1–9);
- a per-subject and per-unit ability estimate (`skill`), calibration, test-out;
- FSRS memory state per card, so "mastered" is real, not a tick box;
- a daily goal ring and a streak.

So this is mostly **showing and rewarding** what Learn already knows, not new
teaching machinery.

## Principles

1. **A map, not a score.** Every number on screen answers "what do I do next?"
2. **Rewards follow learning, not clicking.** XP and badges come from answers
   and from lessons *passed* (the check), never from opening things. Nothing is
   awarded for time-on-page, and nothing is lost (no streak penalties beyond the
   existing streak count, no leaderboards, no hearts).
3. **Never lock.** Prerequisites show as *needs X* but the lesson still opens.
   People who already know a topic (and this is a working electrician's tool)
   must be able to jump in or test out. Locked-looking is a hint, not a gate.
4. **Honest mastery.** A node is "mastered" only when the cards are solid
   (FSRS stability ≥ 21 days, or right on three days), which is what Learn
   already calls solid. "Learned" (passed the check) is the lighter state.
5. **Derived over stored.** XP, rank and most badges are computed from the
   answer log, so they can never drift from the real record; only *which badges
   you have been shown* and *your goal* are stored.

## 1. The tree

A page, **Tree**, first in the Study group. One tree per subject (tabs).

- **Columns are tiers**: the 1–9 stages Learn already uses ("First steps" …
  "Master"), with the stage name as the column heading. Left to right *is* the
  roadmap: easy to hard.
- **Rows are units**: each unit is a branch (a labelled lane). A lesson sits in
  the lane of its unit and the column of its level. Lessons sharing a cell stack.
- **Edges** are the `prereq` links inside the subject, drawn as curves from the
  prerequisite to the lesson. Prerequisites in another subject are listed on the
  node's panel as *needs Physics: AC*, not drawn.
- **Node states**, always shown with a glyph and a word as well as colour:

  | state | glyph | meaning |
  |---|---|---|
  | mastered | ★ | every card solid |
  | learned | ✓ | passed the lesson's check |
  | in progress | ◐ | started, not yet learned |
  | ready | ○ | not started, every written prerequisite learned |
  | needs… | ◌ | a prerequisite is not learned yet (still opens) |
  | not written | · | in the outline only |

  Plus a thin progress bar (solid cards ÷ cards) and the level.
- **Click a node** and a panel opens under the tree: summary, minutes, cards,
  state, what it needs (each with its state, clickable), what it unlocks, and the
  actions: **Start / Continue**, **Test out** (when your level says so),
  **Make this my goal**.
- **Subject header**: your estimated level and its stage name (existing),
  tiers cleared, XP in this subject, *Find my level* if not placed.

## 2. The roadmap (the clear purpose)

A **goal** is any lesson you want to be able to do ("Fault-find a VFD",
"Cables: current rating and volt drop"). Setting one turns the tree into a route:

- the route is the goal plus every unlearned lesson it transitively needs
  (across subjects), in dependency order, ties broken by level;
- the tree dims everything off the route and numbers the route's nodes 1…n;
- a banner reads **Goal: X · 3 of 7 steps · Next: Y [Start]**;
- Today shows the same banner as its main call to action, so opening Learn
  says what to do.

Unwritten prerequisites appear in the route as "not written yet" and are
skipped for the count (they cannot be done), so the route never dead-ends.
One goal at a time; setting another replaces it. Reaching the goal clears it,
shows a "Goal reached" moment and offers the lessons it unlocks as the next goal.

## 3. XP and rank

Derived from the answer log, no new bookkeeping.

- **Answer a card**: right +10, wrong +2 (trying counts, and the cards a wrong
  answer creates come back anyway). Reading a concept card: 0.
- **Learn a lesson** (first pass of its check): +50. Test-out and calibration
  answers earn 0, so placement tests can't be farmed.
- **Rank** `n` needs `50·n·(n−1)` XP in total (rank 2 at 100, 5 at 1000, 10
  at 4500): quick early, slower later. Shown as "Rank 4 · 612 / 1000 XP".
- XP is also kept per subject, shown on its tree header.

Rank is deliberately a different word from *level* and *stage*, which stay what
they are: an estimate of what you can do. XP says how much you have done.

## 4. Unlocks and moments

The moments are where the game feel lives; they are small and skippable.

- **Lesson learned** → the finish screen lists **what this unlocked** (lessons
  whose prerequisites are now all learned) with Start buttons, plus any XP, rank
  and badges earned.
- **Rank up / badge / goal reached** → one toast, then it lives on the
  Achievements page. No sounds, no confetti loops.

## 5. Badges

About twenty, all derived, each with a plain "how" line. Earned ones are stored
(`badge` table) so each is announced exactly once and keeps its date.

First card · 100 / 1000 cards · 3, 7, 30-day streak · ten right in a row ·
first lesson learned · 10 lessons · a unit cleared (every written lesson
learned) · a subject cleared · a lesson mastered (★) · tier 5 / tier 7 lesson
learned · placed in a subject · three subjects started · goal reached ·
a struggling card fixed.

Shown as a grid on a small **Achievements** section of the Stats page, earned
first, unearned greyed with their how-line (so they double as suggestions).

## 6. Daily quests (light)

Three small, always-achievable targets on Today, picked from what is true that
day, not random: *Clear what's due*, *Learn a lesson* (the goal's next step),
*Fix a struggling card*. Each ticks live; the existing goal ring stays the
headline. Quests give no XP of their own: they only point at what already earns it.

## Build order (this branch)

1. `gamify.py` + migration `005_skilltree.sql` (`badge` table) + `v_xp` view:
   XP, rank, badges, route, unlocks. Pure functions over the DB, one self-check.
2. API: `GET tree`, `GET roadmap`, `POST goal`, `GET badges`; `answer` and
   `lesson/place` return XP gained, new badges, newly unlocked lessons.
3. UI: Tree page (SVG edges + node buttons + panel), goal banner on Tree and
   Today, XP/rank chip, finish-screen unlocks, toasts, Achievements.
4. Checks: `tests/test_skilltree.py` (rank maths, route order, unlocks, badges
   awarded once), the web check for the tree layout, content check untouched.
5. README, CHANGELOG, in-app help.

## Not doing (and when to)

- **Hard locks / forced order.** Against the working-adult use. Revisit only if
  someone asks for a "guided" mode.
- **Leaderboards, hearts, streak freezes, loot.** Nothing here is social and
  punishing a missed day teaches the wrong habit; the streak just counts.
- **Several goals at once.** One route is clear; add a list if you find
  yourself wanting two.
- **A drawn, hand-placed tree per subject.** Layout is computed from level,
  unit and prerequisites, so new lessons appear in the right place with no
  editing. If a subject needs a better shape, fix its `level`/`prereq`.
- **Pan and zoom.** Trees are ≤ ~40 nodes; native scrolling is enough.
- **Server-side badge rules in data files.** Rules are code (twenty lines).
  Move them to JSON when course authors, not us, want to define them.
