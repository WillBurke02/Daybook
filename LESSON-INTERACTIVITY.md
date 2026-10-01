# More interactivity in the lessons: how to do it

What a lesson can do today, what is missing, and how to add each thing without
turning the content format into a programming language. Written to be acted on:
each idea says what the learner does, what the card checks, what it costs to
build, and the content-check rule that keeps it honest.

## What already exists (use it more before building anything)

- **Cards that ask**: `mcq`, `numeric` (fresh numbers each time, typed answer),
  `order`, `match`, `steps` (worked, then faded), `code` (Structured Text with
  test cases and a mini PLC), `explain`, `spot the mistake`.
- **Widgets** (`apps/learn/web/widgets/`): circuit, grapher, PID, motor, PLC,
  ladder, impedance, encoder, A-scan, timer, profile, fraction. A `widget` card
  can ask a question *about whatever the learner set* (`"answer": "q_on"`) and
  can **predict first**: controls stay locked until they commit to a guess.
- **Tools beside the card**: the whiteboard and the calculator/grapher.
- **Bench tasks**: do it for real, tick a checklist, log it.

The gap is not widgets; it is that most lessons use them as illustrations, once,
in the learn stage. The biggest win is using what exists *as the way the lesson
asks its questions*.

## Principles for an interactive card

1. **Commit, then see.** The learner acts or predicts *before* the result is
   shown. This is the single thing that separates interactive from animated.
2. **One idea, one thing to do.** If it takes a paragraph to say what to do, split it.
3. **The check is deterministic and written down.** Every interactive card has
   an answer a machine can verify (a value, a state, a sequence, a test case),
   so it can be marked, scheduled by FSRS, and counted in XP like any other card.
4. **Wrong is informative.** A wrong action produces a specific consequence or
   hint ("the lamp stays off: the seal-in contact is wired to the wrong side"),
   not just a red cross.
5. **Always a keyboard route.** Dragging is never the only way (order and match
   already have buttons); everything labelled for screen readers.
6. **Safe by construction.** Simulated procedures (isolation, testing) end in
   the *correct, complete* sequence; a shortcut that would be dangerous on site
   is never rewarded, and the consequence screen says why.

## Ideas, in the order I would build them

### 1. Widget-first practice (no new code; content only)  ·  effort: low

Turn "here is a widget, play with it" into questions the widget answers:

- *Set R₂ so the supply current is 20 mA* (numeric, answer read from the widget
  or checked as a range).
- *Make the lamp come on 5 s after Start* (PLC widget, checked by running it).
- *Find the setting at which this loop just starts to oscillate* (PID).

Every `learn` stage widget card should be followed by one of these in
`practise`. Add a content-check warning for lessons with a widget in `learn` and
no widget-based ask in `practise`. Cost: authoring only.

### 2. Fix the fault  ·  effort: medium

A broken thing the learner repairs, not just describes. Three flavours, one
mechanism (a start state, an editable part, a pass condition):

- **Code**: ST program with a bug; edit until the tests pass (the `code` card
  already does this; add "starts broken" lessons rather than blank-page ones).
- **Ladder/circuit**: click the component that is wrong and choose the fix
  (swap a contact NO↔NC, move a wire to the other terminal).
- **Spot the line**: click the wrong line/step in a worked solution (extends
  `spot` from a pick-one to *point at it*).

Card: `{type: "fix", widget: {...}, broken: <state>, pass: <condition>}`. The
widget already knows how to run; the card adds a pass predicate over its
reported values, which `content.check.mjs` evaluates against the *intended*
fix (so a card that cannot be solved cannot ship).

### 3. Fault-finding scenarios (branching)  ·  effort: medium, highest value for this audience

"The pump will not start." The learner chooses the next test; each choice
returns a result (a reading, a photo caption, a noise) and may close branches.
They finish by naming the fault; scoring is *how many tests* against a model
route, not a single right answer.

```json
{ "type": "scenario", "setup": "Pump 2 will not start from the panel.",
  "nodes": { "start": { "options": [
      { "do": "Check the overload relay", "says": "Tripped.", "next": "ol" },
      { "do": "Measure at the contactor coil", "says": "230 V present.", "next": "coil" } ] },
    "coil": { "...": "..." } },
  "fault": "ol", "good": 3 }
```

Plain data, no engine beyond a graph walk. The check rule: every path ends at a
named fault, `fault` is reachable, and the shortest sensible route length is
declared (`good`). It maps straight onto the fault-finding lessons in
electrical, instrumentation and drives, and onto the bench tasks (do the real
version afterwards).

### 4. Virtual meter / procedure simulator  ·  effort: high, build once

A drawn panel with probe points; the learner puts the meter's leads on points
and reads a value from a small model (a lookup of point-pair → reading under a
named fault). It powers "prove dead", insulation tests, loop checks, continuity.
Order matters and is part of the check ("prove the tester on a known source,
test, prove again"). This is the interactive version of safe isolation, which
is the most safety-relevant lesson in the course. Build it as one widget
(`meter`) driven by a JSON model, then author per lesson.

### 5. Label and sort on a diagram  ·  effort: low–medium

Drop labels onto an SVG (or tap a label then tap a spot, the keyboard route),
or sort items into bins (NO/NC, analogue/digital, TN-S/TT). Extends `match`
with a picture. Check: map of target → label. The artwork is the work, so reuse
the circuit widget's symbols.

### 6. Hint ladder instead of a hint  ·  effort: low

Three levels per hard card: a nudge, a bigger nudge, then the worked first step.
Using hints doesn't lose XP (it is not a test) but it records `hints_used`, and
FSRS treats a hinted correct answer as "hard". The data already allows a
`hint`; add `hints: [..]` and a counter.

### 7. Build-the-answer steps  ·  effort: low

Faded worked examples already exist. Extend them so each step is *chosen* from
plausible next steps (including a tempting wrong one) before it is revealed,
which is `steps` + `mcq` per step. Content-check: exactly one right option per
step, same length-balance rule as other mcqs.

### 8. Quick-fire rounds  ·  effort: low (UI only)

A timed, no-penalty speed round over a lesson's `solid` cards (symbols, units,
colours, ratings) at the end of a unit, for fluency. Uses the existing cards;
only a runner is new. Optional, never on a clock the learner can't switch off.

## How to add a new interactive card type

1. **Name it and give it a JSON shape** in `CONTENT-BRIEF.md` (what the author writes).
2. **Add the type** to `TYPES` in `tests/content.check.mjs` and write its
   validation there: shape, plus *solvability* (run the pass condition against
   the intended solution; fail the build if it can't pass).
3. **Render it** in `apps/learn/web/cards.js` as a `frame()` card, reporting
   `{correct, rating}` through the same `onDone` the other cards use, so marking,
   FSRS, XP and the skill estimate need no changes.
4. **Give the browser check one example** in `tests/web.check.mjs` or the
   learn check: mount it, perform the correct action, expect `correct`.
5. **Write one lesson card** per case before writing twenty; keep the first
   example in the CONTENT-BRIEF as the model to copy.

Everything that touches scheduling, XP and the level estimate stays the same
because the card reports a normal answer. That is why each idea above is
phrased as "what it checks".

## What not to do

- **Animations without a question.** If nothing is asked, it is a diagram.
- **Timers on first attempts.** Speed is for fluency rounds on cards already known.
- **Rewarding clicks.** XP and badges follow answers and lessons passed, not interaction counts.
- **A generic simulator.** Each widget does one job (the existing ones do); a
  "build any circuit" sandbox is a product, not a lesson card.
- **Drag-only.** Anything draggable also works by tap-then-tap and by keyboard.

## Suggested order

1. Widget-first practice questions in the lessons that already have widgets (content only).
2. Hint ladders and build-the-answer steps (small, broad benefit).
3. `scenario` fault-finding (new card type, plain data): start with
   instrumentation and drives fault-finding.
4. `fix` cards on the PLC/ladder widgets.
5. `meter` simulator for safe isolation, then testing.
6. Label/sort and quick-fire rounds as time allows.
