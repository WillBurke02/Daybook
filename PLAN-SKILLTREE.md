# SkillTree: making Learn a map you can see yourself climbing

Branch `SkillTree`. This is the plan the branch implements; what is deliberately
left out is at the end.

> **Superseded in part (Phase 2 of the review):** the Tree page and its goal route
> gave way to **tracks** (apps/learn/content/tracks.json) drawn as a skill map: each
> track a project at work, a line of stops, a goal per track, **Prove it** on a stop.
> The principles below still hold; §1's layout, `GET tree` and `tree.check.mjs` are gone.

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
2. **No points.** XP, rank, badges and daily quests were built and then taken
   out (Phase 0 of the review): they counted clicks, not learning, so they meant
   nothing. What is shown instead is real: lessons learned, cards solid, minutes
   and days studied. No leaderboards, no hearts, no streak penalties.
3. **Never lock.** Prerequisites show as *needs X* but the lesson still opens.
   People who already know a topic (and this is a working electrician's tool)
   must be able to jump in or test out. Locked-looking is a hint, not a gate.
4. **Honest mastery.** A node is "mastered" only when the cards are solid
   (FSRS stability ≥ 21 days, or right on three days), which is what Learn
   already calls solid. "Learned" (passed the check) is the lighter state.
5. **Derived over stored.** Every state is computed from the answer log and
   lesson state, so it can never drift from the real record; only *your goal* is
   stored. A lesson is learned when its check cards are right, wherever they were
   answered (the feed and Review count, not only the lesson player).

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
  tiers cleared, *Find my level* if not placed.

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

## 3. Unlocks and moments

The moments are where the game feel lives; they are small and skippable.

- **Lesson learned** → the finish screen lists **what this unlocked** (lessons
  whose prerequisites are now all learned) with Start buttons. Learned from the
  feed or Review, a one-line flash says the same.
- **Goal reached** → said once; the goal clears. No sounds, no confetti.

## 4. This week, not a score

Today's road panel: minutes studied, days studied and lessons learned in the
last seven days, then the goal's route (or how to set one).

## Build order (this branch)

1. `skilltree.py`: states, route, unlocks, the week, worked out from the answer
   log with plain queries (no view needed). (Migration 005 made a `badge` table;
   006 drops it.)
2. API: `GET tree`, `GET roadmap`, `POST goal`; `answer` and `lesson/place`
   return the lesson just learned and what it opened.
3. UI: Tree page (SVG edges + node buttons + panel), goal banner on Tree and
   Today, the week on Today, finish-screen unlocks.
4. Checks: `tests/test_skilltree.py` (route order, unlocks, feed answers count,
   no points), `tests/tree.check.mjs` (the layout).
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
