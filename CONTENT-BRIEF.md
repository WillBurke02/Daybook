# Brief: writing Learn content for Daybook

Repo: `/home/claude/daybook`. Content lives in `apps/learn/content/<subject>/`.
Each subject has `subject.json` (the outline: units, lesson ids, titles, levels, kinds,
prerequisites). **Do not edit any subject.json, any code, or any file another writer owns.**
Only write the files your task names.

Read these first:
- `apps/learn/content/physics/ut/pulse-echo.json`: the finished exemplar of the lesson format. Copy its shape.
- `apps/learn/content/plc/basics/scan-cycle.json`: examples of `code` cards (Structured Text with tests) and `plc` widget cards.
- `tests/content.check.mjs`: the rules your files must pass.
- `LEARN-SPEC.md` §1–§3 and §7 (the research, the lesson template, the level scale).
- The widgets you use: `apps/learn/web/widgets/<name>.js` (header comment = params and what it reports).

Who it is for: one adult learner in the UK, working in industrial engineering (ultrasonic
testing, PLCs, drives). He may be below GCSE in maths. Write for him: plain British English,
short sentences, "you", bold the key terms, concrete workshop examples (plates, motors,
conveyors, torque settings, pay, measurements). No emoji. Straight to the point, kind but not
chatty. Every fact must be right: check anything you are not certain of (WebSearch/WebFetch are
available). Numbers in answers are worked by the formula, never typed in.

## The lesson file

```json
{
 "id": "<lesson id from subject.json>", "title": "<same title as the outline>", "tags": ["..."],
 "kind": "procedure | concept | facts", "level": <from the outline>, "minutes": <5–30, realistic>,
 "goals": ["2 to 5 things you can do by the end, each starting with a verb"],
 "summary": "The whole lesson in 350 words or fewer, as notes to revise from. Markdown: **bold**, - lists, $maths$, blank lines between paragraphs.",
 "resources": [{"when": "before|during|after", "kind": "video|read|interactive|reference|listen", "title": "...", "url": "https://...", "by": "...", "minutes": 5, "note": "optional: one line on why"}],
 "sources": ["The books, standards, datasheets or manuals the lesson was checked against: real ones only"],
 "formulas": [ ...see Explaining... ],
 "bench": [{"task": "One job to try on the bench or on site, safe as written", "check": ["step", "step"]}],
 "cards": [ ... ]
}
```

Resources: use the verified links given in your task, exactly. Only add another if you have
fetched it and it loads and is on topic. "before" = a short primer to watch/read first;
"after" = going further. Never invent a URL.

Sources: real, correctly titled references (e.g. "IEC 61131-3: Programmable controllers. Part 3: Programming languages",
"Hughes Electrical and Electronic Technology, 10th edition (Pearson)", a manufacturer manual title). No made-up ones.

## Explaining (the learner's own complaint: "a lot is not really explained, especially the formulas")

He said: in PID he did not know what derivatives were or what the formulas meant. So, in every lesson:
- **Never use a symbol, a term or a piece of notation before saying what it means in plain words.** The first
  time a formula appears, say what each letter stands for, in what units, and what the formula *says* in a
  sentence ("the depth is the speed times the time, halved").
- **Calculus and notation in words first.** If a lesson leans on a derivative, an integral, a log, e, Σ, a
  subscript, say it plainly before or as it is used: a derivative is "how fast it is changing right now" (a
  speedometer; the steepness of a graph); an integral is "adding it up over time" (area under the graph; a
  running total). The learner may have no calculus at all: the lesson must still make sense.
- **Every concept card that carries a formula or a hard idea gets `"more"`**: the same idea again, slower, in
  other words, with an everyday or workshop analogy and a worked number (≤ 150 words). It shows behind
  "Explain it another way".
- **Harder questions get `"hint"`** (on a widget card put it inside `ask`): a nudge, not the answer
  ("Which rule: is the time there and back?").
- **Every `why` teaches**: say why the right answer is right *and* why the tempting wrong one is wrong.
- **Lesson `"formulas"`** (Formula help): list every formula the lesson uses, at the top level of the lesson
  file, next to `sources`:
  ```json
  "formulas": [{"name": "Depth from the echo time", "tex": "d = \\frac{vt}{2}", "match": ["\\frac{vt}{2}"],
    "says": "One or two plain sentences: what the formula tells you.",
    "symbols": [["d", "the depth (metres; × 1000 for mm)"], ["v", "the speed of sound in that material (m/s)"]],
    "example": "A worked number: steel, echo at 10 µs: … about 29.6 mm."}]
  ```
  `match` is one or more pieces of TeX that, when they all appear in a card's maths (spaces ignored,
  `\tfrac` read as `\frac`), mean "this card uses this formula": pick something distinctive. Every letter
  in `tex` gets a `symbols` row. The general notation (fraction lines, powers, subscripts, d/dt, ∫, Σ,
  Greek letters, logs) is already explained in `apps/learn/content/symbols.json`: read it, do not repeat it,
  and tell me if a piece of notation you use is missing there.
- Short sentences, one idea each. Numbers before letters: show it with numbers, then write the rule.

## The stages (in this order, every card has `"stage"`)

| stage | cards | what |
|---|---|---|
| try | 1–2 | The lesson's key question asked cold, before any teaching. A guess is fine; the answer is shown. |
| learn | 3–6 pairs | One idea per `concept` card (≤ 120 words, a widget as its figure where useful), each followed AT ONCE by an asking card on that idea. |
| example | 3 (procedure) | A `steps` card with `"worked": true` (every step shown), then a `steps` card with `"given": 1` or 2 (faded: you do the rest), then a problem of the same kind (usually `numeric`). Concept lessons may skip this stage; facts lessons usually do. |
| practise | 4–9 | Your own problems, getting harder: numeric templates, widget questions, code, order, match. Include one "why" mcq. |
| mix | 3–5 | Problems that look alike but need different rules, from this lesson and earlier ones ("halve or not?", "which formula?"). **Facts lessons have no mix stage.** |
| check | 3–4 | The key points, cold. Include a new variant of the try question (a different card with a new id, same idea). Prefer marked cards (mcq, numeric, order, match, code) over flash. |

Aim for 18–28 cards. The warm-up stage is automatic: do not write it.

**Bench tasks** (`bench` in the lesson file): one or two things to try for real, on the bench or on site,
with a short checklist. They show at the end of the lesson, and a line goes to today's Log when he has done
one. Safe as written: say the voltage, the rating, the isolation, the meter range. Nothing mains-voltage, and
nothing that needs a permit, unless the lesson is about exactly that and says so.

Kinds: **procedure** (a method you carry out: all stages, example chain required),
**concept** (why/what: try can be a problem to attempt; example optional),
**facts** (terms, data types, standards: short learn cards, then flash/match/order; no mix).

## Cards

Ids: lower case words and dashes, unique in the lesson, and **forever** (progress hangs off them).

- `concept`: `{title, body, widget?, more?}`. body ≤ 120 words; `more` ≤ 150 words (see Explaining).
- `mcq`: `{q, options: [3–5 strings], answer: <index>, why, hint?}`. Put the right answer anywhere (they are shuffled on screen, but vary it anyway). Distractors are real mistakes people make. **The right option must not give itself away**: keep all options alike in length and detail (a bare claim each), and put the reasoning in `why`. The check fails a right option much longer than every wrong one.
- `numeric`: `{q, vars, let?, answer, unit?, tolerance? | abs?, work, why, hint?}`
  - `vars`: `{"t": [lo, hi, step]}` or `{"f": {"pick": [1, 2, 5]}}`. Drawn fresh each time.
  - `let`: `{"t1": "2 * d / 5920 * 1000"}`, worked in order, usable in text as `{t1}`.
  - `answer`: a formula over vars and lets. Functions: `SQRT POWER EXP LN LOG10 PI() SIN COS TAN ASIN ACOS ATAN RADIANS DEGREES ROUND(x, n) ROUNDUP ROUNDDOWN ABS MOD(a, b) IF(c, a, b) MIN MAX`; `^` is power. Trig is radians.
  - **Names ignore case and underscores**: never have both `V` and `v`, or `t1` and `T1`.
  - `tolerance` is relative (default 0.02 = 2%); use `abs` for answers that can be 0 or when an absolute error makes sense.
  - Text shows values as `{t}` (`{t:2}` = 2 decimal places); `{answer}` in `work`/`why`.
  - **Every `{name}` is replaced, in maths too.** `$\frac{d}{v}$` with a var `d` breaks. Write `{{d}}` to put the value in TeX (`x^{{n}}`), and `{ d }` (spaces) for the letter. The check catches this.
  - The answer box takes arithmetic (`5920*10/2000`), so no calculator is needed.
  - Choose ranges so every draw is sensible (no negative lengths, no division by zero). The check draws 200 times.
- `steps`: `{q, steps: [{ask, show}], why}` plus `"worked": true` or `"given": n` (1 ≤ n < steps). Two or more steps.
- `order`: `{q, items: [in the right order, 3+], why}`.
- `match`: `{q, pairs: [["term", "meaning"], ... 3+], why?}`.
- `flash`: `{front, back}` (self-rated).
- `code`: Structured Text with `___` blanks; see scan-cycle.json. `{q, code, inputs, outputs, solution: [one per blank], tests: [{name, steps: [{set, scans?, expect?}]}], why, blank_size?}`. Tests scan every 100 ms. The interpreter (`apps/learn/web/st.js`) knows BOOL, INT family, REAL, TIME (T#2s), IF/CASE/FOR/WHILE, TON TOF TP CTU CTD R_TRIG F_TRIG SR RS.
- `widget`: `{intro, widget: {name, params}, ask: {type: "mcq" | "numeric", ...}, predict?}`. A numeric ask's `answer` can use what the widget reports (names in its REPORTS), e.g. `"answer": "q_on"`, so the question is about whatever he set. No vars on widget asks.
  - `predict` (**predict, then see**): `{q, options: [2–5], answer?, why?}`. The controls stay locked until he commits to a guess about what will happen ("if you make $R_2$ bigger, the supply current…"); afterwards the card says whether he was right and gives `why`. Guessing first, even wrongly, makes what he then sees stick. Put it on the widget card where the lesson's key cause-and-effect first shows. Leave `answer` out for an open "what do you expect?".
- `explain` (**explain the step**): `{q, context?, model, points?}`. After a worked example: "Why does step 2 divide by the total?" He types his answer (not marked), then sees `model` (≤ 120 words) and ticks the `points` (2–6) his made, and rates himself. `context` repeats the step so the card stands alone. One per procedure lesson, straight after the worked example.
- `spot` (**spot the mistake**): `{q, lines: [3–9], wrong: <index>, fix, why, mono?}`. Working, a ladder rung per line, or a listing with **one** line wrong; he picks it. `fix` is the line put right; `why` says what the slip was and the check that catches it (a sanity check, a units check). The mistake is a real one people make (a decimal point, the wrong formula, a normally closed contact where an open one belongs). `mono: true` shows the lines monospaced with their spaces (code, rungs; no maths in them).

Maths: `$...$` inline, `$$...$$` display. TeX subset: `\frac \tfrac \sqrt \times \div \cdot \text{} \log \sin \ln ^{} _{} \approx \le \ge \pm \Omega \omega \theta \Delta \pi \lambda \mu \circ`, etc. The check fails any maths that does not parse. Units outside maths are plain text: "5920 m/s", "4.8 µs", "10 kΩ".
Formatting in text: `**bold**`, `*italic*`, `` `code` ``, "- " lists, blank line = new paragraph. No tables, no headings.
A fenced block (a paragraph that starts with ``` and ends with ```, no blank lines inside, no `$`) shows
monospaced with its spaces kept: use it for ladder rungs and code listings, e.g.
"```\n|--[ Start ]--+--[/Stop ]--( Motor )--|\n|--[ Motor ]--+\n```".
Ladder notation: `[ A ]` normally open contact, `[/A ]` normally closed, `( Q )` coil, `(S)`/`(R)` set/reset coils, `[P]`/`[N]` edge contacts.

## Levels: our own scale (stages 1–9, the UK RQF alongside)

| stage | name | roughly | RQF |
|---|---|---|---|
| 1 | First steps | whole numbers, simple sums, reading a scale | Entry 1–2 |
| 2 | Basics | times tables, fractions, decimals and units | Entry 3 |
| 3 | Foundation | percentages, simple formulas and graphs | Level 1 (GCSE grades 1–3) |
| 4 | Secure | rearranging formulas, standard form, Ohm's law | Level 2 (GCSE grades 4–9) |
| 5 | Advanced | calculus, waves, PLC programming | Level 3 (A level) |
| 6 | Higher | control loops, drives, circuit analysis | Level 4 (HNC) |
| 7 | Diploma | tuning, design and fault finding | Level 5 (HND) |
| 8 | Graduate | system design | Level 6 (degree) |

A level is a decimal (4.3 = low in "Secure"). A card's `level` is how hard *that card* is: the
level at which someone gets it right about half the time when typed (a person *at* the lesson's
level gets ~8 in 10 of its cards right). Leave `level` off a card that is at the lesson's level;
set it on easier recall cards (−0.3 to −1.0) and harder multi-step ones (+0.3 to +1.0). Every
asking card must be within ±1.5 of the lesson's level.

## Calibration banks (`apps/learn/content/<subject>/calibrate.json`)

```json
{"subject": "<subject id>", "cards": [
  {"id": "cal-<short>-<word>", "lesson": "<a lesson id in the outline>", "level": 4.6, "type": "numeric", ...}
]}
```
- Ids start `cal-`, unique in the file.
- Types: `mcq`, `numeric`, `order`, `match` only. No widgets, no steps, no flash, no concept.
- **At least 3 per outline lesson** (every lesson in subject.json, written or not), with levels spread across the lesson's level −0.8 to +0.8 (never below 1 or above 9): e.g. one easy, one at level, one hard.
- Self-contained: no "in this lesson", no widget; answerable in a minute or two with the answer box's arithmetic. Prefer `numeric` (a typed answer tells us far more than a 1-in-4 guess); where mcq, use 4 options.
- They place the learner, so they test the *core* of each lesson, not trivia.

## Checking your work

**Write each file as soon as it is finished** (and check it), before starting the next: work can be cut off, and a finished file survives.

Run `node tests/content.check.mjs 2>&1 | grep -E '<your lesson ids or file paths>'` until it prints
nothing for your files (others' files are being written at the same time; ignore their lines,
and rerun if it trips over a half-written file). Then:
`cd /home/claude/daybook && python3 -c "from apps.learn.app import read_content; s,u,l,c = read_content(); print(len(c))"` must not raise.
Write each file in one go (the Write tool), JSON with `indent=1` style is fine.

Finally, reread your cards once as the learner: is every answer right, every distractor wrong,
every `why` true, every number sensible? Fix what is not.

Report back briefly: files written, card counts, anything you were unsure of.

## Verified links for the lessons still to write

- plc.basics.data-types: before read "The Mysterious World of the S7 Data Table" https://www.rtautomation.com/rtas-blog/the-mysterious-world-of-the-s7-data-table/ (Real Time Automation, 3); after reference "Using absolute addressing to access CPU data" https://docs.tia.siemens.cloud/r/simatic_s7_1200_g2_manual_collection_enus_20/plc-concepts-configuration-and-programming/program-structure/data-storage-memory-areas-i/o-and-addressing/using-absolute-addressing-to-access-cpu-data (Siemens, 8); after reference "Data types" https://docs.tia.siemens.cloud/r/simatic_s7_1200_manual_collection_enus_20/plc-concepts/data-types/data-types (Siemens, 5); after read "Understanding Floating Point Numbers in PLC Programming" https://control.com/technical-articles/floating-point-numbers-in-plc-programming/ (Control.com, 5)
- plc.basics.ladder: before video "What Is Ladder Logic in PLC Programming?" https://www.youtube.com/watch?v=MK2-LD0q0kY (RealPars, 7); after read "PLC Ladder Logic Programming Tutorial (Basics)" https://www.plcacademy.com/ladder-logic-tutorial/ (PLC Academy, 17); after read "PLC Latching vs Sealing Explained Simply" https://www.realpars.com/blog/sealing-and-latching-plc (RealPars, 5)
- plc.basics.timers-counters: before video "PLC Timer Programming for Beginners" https://www.youtube.com/watch?v=BHbOXDt5O3o (RealPars, 8); after read "TIA Portal – TON / TOF / TP Timers And Different Use Cases" https://liambee.me/siemens/tia-portal/ton-tof-tp-timers-and-different-use-cases/ (Liam Bee, 9); after read "Understanding PLC Program Commands: Up and Down Counters" https://control.com/technical-articles/understanding-plc-program-commands-up-and-down-counters/ (Control.com, 7); after read "PLC Counter Programming for Beginners" https://www.realpars.com/blog/plc-counter (RealPars, 9)
- plc.basics.edges: before read "Understanding PLC Program Commands: One-Shots" https://control.com/technical-articles/understanding-plc-program-commands-one-shots/ (Control.com, 7); after read "Ladder Logic Tutorial - Part 2: Building Logic" https://www.plcacademy.com/ladder-logic-tutorial-part-2/ (PLC Academy, 20); after reference "Positive and negative edge instructions" https://docs.tia.siemens.cloud/r/simatic_s7_1200_manual_collection_enus_20/basic-instructions/bit-logic-operations/positive-and-negative-edge-instructions (Siemens, 5)
- drives.motors.induction: before video "How does an Induction Motor work?" https://www.youtube.com/watch?v=N7TZ4gm3aUg (The Engineering Mindset, 11); after read "Tesla Polyphase Induction Motors" https://www.allaboutcircuits.com/textbook/alternating-current/chpt-13/tesla-polyphase-induction-motors/ (All About Circuits, 20); after reference "Electrical Induction Motors - Slip" https://www.engineeringtoolbox.com/electrical-motor-slip-d_652.html (The Engineering ToolBox, 4)
- drives.motors.vf-vector: before read "Choosing VFD control modes" https://www.processingmagazine.com/pumps-motors-drives/variable-frequency-drives/article/21141739/automation-direct-choosing-vfd-control-modes (Processing Magazine, 7); after read "Defining Scalar and Vector Control in VFD Outputs" https://control.com/technical-articles/defining-vector-and-scalar-control-for-vfds/ (Control.com, 5); after video "Understanding Field-Oriented Control | Motor Control, Part 4" https://www.mathworks.com/videos/motor-control-part-4-understanding-field-oriented-control-1587967749983.html (MathWorks, 10); after reference "ABB drives: Technical guide book" https://library.e.abb.com/public/a209d9dc29b24b789e0650b8de9c3f22/TechnicalGuideBook_EN_3AFE64514482_RevI.pdf (ABB, 45)
- drives.feedback.encoders: before read "What Is an Encoder?" https://www.realpars.com/blog/encoder (RealPars, 5); after read "Quadrature Encoders - The Ultimate Guide" https://www.dynapar.com/knowledge/encoder-basics/encoder-output/quadrature-encoders/ (Dynapar, 5); after read "Resolvers - What Are They and How Do They Work?" https://www.dynapar.com/knowledge/encoder-basics/encoders-vs-resolvers/resolvers/ (Dynapar, 5)
- drives.motion.profiles: before read "What is a motion profile?" https://www.motioncontroltips.com/what-is-a-motion-profile/ (Motion Control Tips, 4); after read "Mathematics of Motion Control Profiles" https://www.pmdcorp.com/resources/type/articles/get/mathematics-of-motion-control-profiles-article (Performance Motion Devices, 10); after video "Motion Control - S-curve Move Profile (Part 8 of 8)" https://www.youtube.com/watch?v=hf1_k3VE_XU (AutomationDirect, 6)
