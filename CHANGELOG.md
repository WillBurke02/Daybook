# Changes

## 4.0.39 — 22 October 2026

- **Log keeps your place while you write**: going from one entry (or the diary) to the next no longer
  redraws the day under you, which lost the box you had moved to and, on a phone, closed the keyboard. The
  day is drawn again once you leave the box.
- **Nothing typed is lost on leaving**: switching to another app on the phone, or closing the window, saves
  the box being typed in, as leaving the box does.
- **Swipe between days** on a phone: left for the next day, right for the day before, as `]` and `[`.
- **Lighter pages**: a day no longer carries every picture waiting from the share sheet (the phone kept a copy
  of each answer, pictures and all), and Log no longer asks the server for them on every page: only when the
  day says some are waiting.

## 4.0.38 — 22 October 2026

- **Questions inside the Mechanical book lessons**: bearings, screws, friction, guides, fatigue, DFMA,
  drawings, tolerances and fits, GD&T, CAD, vibration and condition monitoring, work and energy, rotation,
  oscillation and beams now ask after each section: 70 new questions, with a worked and a faded fit
  calculation (H7/g6, H7/k6), clearance in µm, third- and first-angle projection, beam stiffness and sag,
  running cost in pounds, and kinetic and rotational energy.

## 4.0.37 — 22 October 2026

- **Questions inside the Fluids book lessons**: pneumatic circuits and solenoid valves, servo valves,
  Bernoulli and flow, thermodynamics and heat transfer now ask after each section: 32 new questions, with a
  worked and a faded cylinder-force example, pipe flow and continuity, a pitot tube, Poiseuille's fourth
  power, the first law, engine efficiency and radiation's fourth power.

## 4.0.36 — 22 October 2026

- **Questions inside the Electronics book lessons**: op-amps, filters, power supplies, serial links,
  microprocessors and EMC now ask after each section: 42 new questions, with worked and faded examples
  (a non-inverting amplifier, choosing an RC filter's capacitor), a mistake to spot (an inverting amplifier
  worked with the wrong formula), and numbers to work: a follower's input difference, buck converter and
  dropout voltages, linear regulator efficiency, ground-loop noise.

## 4.0.35 — 22 October 2026

- **Questions inside the Instrumentation book lessons**: all 18 now ask after each section, 102 new
  questions: the 4–20 mA chain, RTDs and thermocouples, pressure, level and magflow, load cells (with a worked
  and a faded weighing example), valves and actuators, calibration, ADCs and aliasing, step tests and tuning,
  cascade, ratio and split-range control, alarm rates, and the control theory lessons (block diagrams, second
  order, Bode plots, stability, sampled systems).

## 4.0.34 — 22 October 2026

- **Questions inside the Drives book lessons**: feedforward, gears and cams, linear motors and steppers now ask
  after each section: 26 new questions, from gear speeds and torques, module, hunting sets and double
  reductions to stepper torque terms, wiring and step angles, and linear-motor force.

## 4.0.33 — 22 October 2026

- **Questions inside the PLC book lessons**: SFC and FBD, Structured Text, state machines, HMIs, Modbus,
  analogue scaling, PID blocks and machine safety now ask after each section: 46 new questions. Among them,
  three Structured Text programs to finish and run against tests (an on-delay timer, counting presses with
  R_TRIG, a CASE sequence for a conveyor), Modbus relative addresses, scaling with a live zero (with a worked
  and a faded example, and a mistake to spot), a P-only controller's output, and ISO 13849 categories.

## 4.0.32 — 22 October 2026

- **Questions inside the book lessons, starting with Electrical**: three-phase, transformers, harmonics,
  earthing, protective devices, test equipment (GS38), motor circuits and ATEX, and phased array and TOFD,
  now ask you something straight after each section instead of 10 to 30 cards of reading first: 79 new
  questions, among them worked and faded examples (delta line current, transformer ratios), a TOFD depth
  by Pythagoras, residual current from clamp readings, CT ratios and a seal-in wiring mistake to spot.
- **DoITPoMS questions explained properly**: the answers to five lessons' DoITPoMS questions came with the
  page's tracking script as their explanation. Fixed in the importer and the lessons re-imported (two of
  them cleaned in place while the site was down); worked answers now keep their equations, which are pictures.
- An import that fails half way no longer loses a lesson's "another account" reading.
- Several of Daybook's cards placed after the same book card now keep their order through a fresh import.
- The content check catches a sum written in a question's double braces, which would have shown as written.

## 4.0.31 — 22 October 2026

- **Learn audit**: every lesson judged on how well it makes you learn (LEARN-AUDIT.md), with what would
  help most, in order. The first fixes are below; the rest follow in the next versions.
- **A wrong number now says what went wrong**: if the digits are right but the answer is 1000 times out,
  it says to check the units and prefixes; twice or half, 60 times (minutes and seconds), 2π, √2 (peak and
  RMS), √3 (line and phase), the wrong sign, or rounded too early: each gets its own line above the working.
- **Mixed in**: a lesson with no mix stage of its own now has up to three questions you have met before, from
  the lessons it builds on and then the rest of its subject, just before its check. Telling which rule a
  problem needs is the skill; a lesson that only asks about itself never tests it.
- **Review is a 12-minute round**, the cards most at risk of being forgotten first (struggles, then the lowest
  chance of remembering now). When the round ends, the rest wait, or you can start another. Today and Home
  show the minutes rather than a count like "257 due".
- **A lesson is learned on its marked questions**: tapping Good on a flash card no longer passes a lesson's
  final check where the lesson has marked check questions. Lessons already learned stay learned.

## 4.0.30 — 20 October 2026

- **Everything backed up to GitHub, encrypted**: besides Log as Markdown, the daily GitHub backup
  now sends every database (Hours and pay, Spending, Log, Learn, your settings), Log's photos,
  voice notes and videos, and imported courses, encrypted with a backup code shown in Admin →
  GitHub. Each photo and video goes once; after that a day's backup sends only what changed, and
  the repository keeps the latest copy rather than piling up old ones. Keep the code in your
  password manager.
- **Restore on a new computer**: `python3 daybook.py restore --repo you/daybook-log` brings it all
  back, photos included, with the same password and phone keys.
- With sync between computers switched on, saving a video in Log failed. Videos now stay on the
  computer they were added on, and everything else still syncs.

## 4.0.29 — 18 October 2026

- **Less wasted space**: the figures at the top of Hours and pay, Spending and the other apps were
  being drawn as tall boxes meant only for Home's Tiles view. They are compact again, so more fits on
  a screen, above all on the phone. Home also uses more of a very wide screen.
- Learn's Today page no longer scrolls sideways on a phone (the feed-weights table now scrolls on its own).
- Home's bills list says "due this week, and any late", and marks a bill not yet ticked off as late
  instead of listing an old date under "the next 7 days".

## 4.0.28 — 18 October 2026

- **Faster everywhere**: every request to the Pi was waiting about 40 ms for nothing (the network
  holding back the reply until the browser acknowledged its first half). Turned off: a call that took
  45 ms now takes 6 to 10, and pages open 35 to 45% sooner on a PC.

## 4.0.27 — 18 October 2026

From the suggestions box:

- **Admin from Home**: an Admin button at the top of Home, and in its menu, straight links to setting
  up the phone and connecting GitHub.
- **Step-by-step guides in Admin.** GitHub: make the private repository, make the token (exactly which
  boxes to tick), fill in, test, with a tick against each step done. The phone: the Home Screen app,
  the widget (Scriptable, where to tap), the two Shortcuts, and the calendar subscription, each with
  its own key beside its steps.
- **Photos in Log**: a section a month with its count, bigger tiles on a big screen, All / Photos /
  Videos, jump to any month, more tags, and the next page loads as you scroll. A photo opens large and
  ← and → (or a swipe on the phone) step through the rest.
- **Timeline**: up to four lines of each entry (tap for the rest), and All / Work / Diary / With photos.
- **Learn**: a question about a widget you set yourself no longer accepts settings that make the
  answer 0 (such as an encoder at 0 rpm).

## 4.0.26 — 17 October 2026

- **18 more lessons**, each with questions of its own: block diagrams, Bode plots, stability, digital
  control and Laplace transforms (Wikibooks' Control Systems); SQL, design patterns, data structures,
  Wireshark and industrial PCs; design for manufacture, linear guides, metals (with 6082, S275 and S355
  for the UK), CAD, gearing and cams, feedforward; functional safety under ISO 13849 (with the GB
  machinery regulations and PUWER); and report writing from GOV.UK's own writing guidance.
- **A second source for 17 more lessons** that leant on one: the Electricity at Work Regulations on
  testing and on overcurrent protection, DoITPoMS on bearings and steel, the NCSC on securing devices,
  GitHub Docs on Git, and Wikipedia for the rest.
- The importer no longer waits on a site that asks it to come back in ten minutes; it leaves that
  figure out instead.

## 4.0.25 — 17 October 2026

- **33 more lessons**, each with questions of its own. Software from the makers' own documentation:
  C#, object-oriented design, async, testing, logging, WPF and MVVM, and clean architecture from
  Microsoft Learn; Git from Pro Git; CI from GitHub Docs; HTTP and JavaScript from MDN. Process
  capability from NIST's e-Handbook (with ISO 9001 and UKAS for the UK). From Wikipedia: OPC UA and
  MQTT, EtherCAT, ISA-88 batch, Structured Text and IEC 61131-3, SFC and FBD, historians, real-time
  systems, phased array and TOFD, bearings, ball screws, fatigue, fits, GD&T, drawings (with UK
  first-angle projection and BS 8888), G-code, linear motors, power supplies, the oscilloscope and
  servo valves. State machines from Lessons In Electric Circuits.
- Code in imported lessons shows as a proper block, and is never read as maths.
- Lessons imported earlier were cut again with the newer rules, so tables stay with their lead-ins.

## 4.0.24 — 16 October 2026

- **13 more lessons**, with questions of their own. From UK sources: the EMC Regulations 2016 and the
  Supply of Machinery (Safety) Regulations 2008 (gov.uk's guidance, and the technical file and
  declarations from legislation.gov.uk), HSE's GS38 on test equipment, and the Electricity Safety,
  Quality and Continuity Regulations on earthing. From Lessons In Electric Circuits (an open textbook):
  three-phase, transformers, harmonics, filters, Fourier, stepper motors, op-amps and microprocessors.
  From Wikipedia: earthing systems, circuit breakers and RCDs (with the UK's rules), ground loops.
- The questions bring in UK practice: 400/230 V and the cable colours, BS 7671's fault loop sums and
  MCB curves, typical Ze values, G5/5 on harmonics, control transformers under BS EN 60204-1.
- An imported card no longer ends on "…as follows:" with the table on the next card.

## 4.0.23 — 16 October 2026

- **A second source for 41 lessons** that leant on one, kept with the lesson as "more to read", as
  published. UK first: the law itself from legislation.gov.uk (the Management Regulations on risk
  assessment, PUWER on guards and isolation, the Electricity at Work Regulations on isolation, UK GDPR on
  security, the NIS Regulations on OT security), HSE's guide to DSEAR, and Cambridge's DoITPoMS on
  corrosion, conduction, magnetic materials, dielectrics, friction and wear, and batteries. Where no UK
  source fits, Wikipedia (thermocouples, Modbus, PID, control valves, RS-485 and more).
- Lessons imported from a source can now carry more to read, and keep it when imported again.
- The importer waits and tries again when a site says it is busy, and copes with spaces in file names.

## 4.0.22 — 16 October 2026

- **22 more lessons**, from Lessons In Industrial Instrumentation (an open textbook): 4 to 20 mA loops
  and scaling, temperature, pressure, level and flow sensors, load cells, control valves, calibration,
  data acquisition, step tests, loop tuning, cascade, ratio and split-range control, PID blocks, HMIs,
  Modbus, Ethernet, TCP and UDP, RS-232 and RS-485, serial data, vibration, motor control circuits,
  pneumatic circuits and SCADA (with the NCSC's guidance on knowing your OT estate). Each has its own
  questions, with UK practice where it differs (thermocouple colours, NAMUR signal levels, Siemens scaling).
- Imported PDFs read better: equations, tables, code listings and scales come through as pictures of
  the page rather than broken lines of text; text boxes and case studies stay as words; captions stay
  with their figures; and lines in HSE's guidance now join into paragraphs.
- Two lessons taken from one source page no longer share (and overwrite) one saved copy of it.

## 4.0.21 — 16 October 2026

- **Lessons from UK sources**, word for word with a link to each as published: the law (the Health and
  Safety at Work Act, PUWER, UKCA and CE marking from gov.uk), risk assessment, permits to work and isolation,
  guards (HSE's PUWER code), hazardous areas (DSEAR zones), alarm handling (HSE), OT and password security
  (NCSC), and from Cambridge's DoITPoMS: piezoelectrics, heat treatment, composites, additive
  manufacturing, beams and torsion. The DoITPoMS questions come too, marked, with their own explanations.
- Each of them has questions of its own as well, including longer ones worked in steps.
- Equations written in TeX in a source now show as maths.

## 4.0.20 — 16 October 2026

- The ☰ menu no longer draws a circle beside every item (Home's round tick buttons were styled for the
  whole app; they are Home's alone now). The setup checklist on Home is plain again too.

## 4.0.19 — 15 October 2026

- **Five new machines to run in 3D**: a mass on a spring and damper on a shaker, a generator (a coil turning
  between two poles, with its sine wave on the trend), a control panel warming up with a thermostat fan, a
  ball launcher with a target, and a beam balanced on a pivot. Each has faults to find or a goal to meet.
- **More to the imported lessons**: 22 of them gain context from the job and longer questions worked in
  steps (a starter motor and its battery, a hoist's motor size, fan sizing for a panel, a venturi flowmeter,
  mesh currents by matrices, shafts out of tolerance, two sensors on one guard), with fresh-number
  questions to follow. Cards that are not from the book say Added.
- Machine trends are sampled as the machine runs, so fast waves (50 Hz) draw as waves.

## 4.0.18 — 15 October 2026

- **25 more lessons from OpenStax**, word for word with a link to each section as published: measurements
  and uncertainty, waves, superposition, EMF and internal resistance, electric and magnetic fields,
  induction, projectiles, moments, friction, work and power, rotation, vibration, damping, Bernoulli,
  heat transfer, the first law, differential equations, matrices, corrosion, and five statistics lessons
  (sampling, data, probability, distributions, hypothesis tests).
- Imported exercises keep their instruction ("For the following exercises, …"), and ones that lean on a
  figure or an earlier exercise are left out of the check.

## 4.0.17 — 15 October 2026

- **Plainer wording**: hints and notes across Log, Learn, Money, Home and Admin say less. The ones
  that explained the obvious (how tags work, what Ctrl+Enter does) are gone.
- Demo data and the Learn tracks no longer name a particular employer or project.

## 4.0.16 — 15 October 2026

- **Less repetition in Learn**: the same few questions kept coming round while most never did.
  - The feed's practice (a numeric question you have met, with new numbers) now waits a day before a
    question comes back, and picks the ones you have not seen for longest. A practice set asks each
    question once.
  - The lessons brought in from OpenStax had swollen: one had 211 cards. The book's review of another
    course ("Practice Makes Perfect", "Objective 1… (IA 3.5.3)") is gone; a lesson keeps two worked
    examples and one "Try It" a heading, leaves proofs whole in the original page, and drops exercises
    that lean on a graph or table the card cannot show. That lesson now has 146 cards, 25 of them
    practice instead of 59. A link the book left empty ("graphed in .") now says "the figure".

## 4.0.15 — 14 October 2026

- **Home, three ways**: a switch at the top of Home picks how it looks, and a phone and a computer
  each keep their own choice (also under the menu, Home shows).
  - **Today**: the day in a line (your shift, payday this week, how much there is to do), every
    app's figures, a Today list of reminders, bills due and Learn's review that you tick off right
    there, the box to add to Log, so far today (entries, photos, commits), the week's hours as bars,
    Learn's ring, on this day a year ago, and the bills coming up.
  - **Tiles**: each figure, list, the Log box, Learn's ring, latest photos, GitHub today and on this
    day as a tile. Arrange moves them earlier or later, makes one wide, or hides one, and works on
    a phone.
  - **Timeline**: the week along the top (hours, payday or a reminder under each day); tap a day to
    see it as a line of hours, with your shift as a band down the side, everything else at its time,
    a line for now, and payday, bills and days off along the top.
- Each app now tells Home about a day (shifts, bills, payday, days off, entries, reminders, commits,
  the review), and Log's Home card carries on this day and the latest photos.

## 4.0.14 — 14 October 2026

- **Works with no signal**: Daybook now keeps a copy of itself on the phone (a service worker).
  With the Pi out of reach (no signal, Tailscale off), a page opens straight away with what it showed
  last time, and a bar says so; tap it to try again. On a slow signal a page waits two seconds at
  most before showing what it kept. Scripts, styles and fonts come from the phone.
- **Log keeps what you add offline**: an entry (with its photos, voice note and videos) written with
  no way to the Pi is kept on the phone, as written, and sent by itself on the next visit or as soon
  as the phone is back online. The box says how many are waiting.

## 4.0.13 — 14 October 2026

- **Pages stop jumping on a phone**: each panel remembers how tall it was and keeps that room while
  its figures load, so panels arriving one by one no longer push the page about (Spending's At a
  glance used to shove everything down as it arrived). Measured on a slowed-down phone, from the
  second visit on, no app's page moves as it loads; before, Log's moved most of a screen.
- **Log's day**: its date and buttons draw before the day's entries are fetched, so the box below
  stays put; Reminders and GitHub appear only when there is something, and keep their place if there
  was last time.
- **Taps feel like taps**: no grey flash, no wait for a possible double tap, a button dims while
  pressed, and nothing stays lit after a tap (hover styles now only on a mouse).
- **Fonts**: one stylesheet for every app, its fonts fetched with the page, and text never changes
  size once drawn. Tab labels stay on one line.

## 4.0.12 — 14 October 2026

- **GitHub in Log**: Admin → GitHub takes your username, a token and, if you like, a private
  repository. Your commits, pull requests, issues and releases then show on each day in Log (the day
  page fetches anything new in the background, a quarter of an hour apart at most), and are kept,
  though GitHub itself forgets after 90 days.
- **Log backed up to GitHub**: once a day (and with Back up now) Log goes to that repository as
  Markdown, a file a month (`log/2026/2026-10.md`: a heading a day, the diary, the entries by time,
  how many photos) and `log/tags.md` with what each tag stands for. Only months that changed are
  sent. Photos stay in Daybook. The token is kept in suite.db only, never in log.db or the sync files.

## 4.0.11 — 14 October 2026

- **Share to Log on iPhone**: the phone capture key now also opens `/log/share`, so a Shortcut in
  the share sheet can send photos, and a note with #tags, straight into today's Log. Admin →
  Calendar feed and phone lists its five steps with your key filled in. Photos the Shortcut sends
  one at a time, a minute apart at most, join the same entry.

## 4.0.10 — 14 October 2026

- **Log to Learn**: the card button on a Log entry makes it a Learn flash card. The entry's text
  starts the front, to turn into a question; you write the answer on the back. It is filed in Learn
  under My cards, From Log (with the day it came from) and comes up in reviews like any other card.

## 4.0.9 — 14 October 2026

- **Photos in Log**: a Photos page shows every photo and video as a grid, newest first, with the
  date on each. The tags along the top show one tag's alone (#site: every photo from site).
  Tap one to see it full size; its date opens the entry. A tag's timeline links to its photos.

## 4.0.8 — 14 October 2026

- **What a tag stands for**: Log → Tags → Edit gives a tag a note (#pump-3: "the duty pump in the
  basement plant room"). It shows on the Tags page, at the top of the tag's timeline (with Add one or Edit),
  and when you point at the tag on an entry or in the suggestions as you type. Renaming a tag takes
  its note along; merging two joins their notes. Undo puts both back.

## 4.0.7 — 14 October 2026

- **Reminders in Log**: write `!fri`, `!tomorrow 9:00`, `!16/10`, `!3d` or `!2w 2pm` in an entry and it
  becomes a reminder, counted from the entry's own day. It shows at the top of that day in Log
  (today also keeps any earlier one not yet ticked off), as a chip on the entry, on Home, and in the
  calendar feed with an alert at its time (9:00 if it has none). Tick it off and it leaves the feed;
  change the date in the text and it is to do again.

## 4.0.6 — 14 October 2026

- **Calendar alerts**: the calendar feed now carries alerts. A bill alerts at 9:00 the day before,
  payday at 8:00 on the day, and Learn's daily review at the time you choose (Learn → Settings,
  beside the reminder; 19:00 unless changed), now a timed event rather than all day.
  On an iPhone, turn off Remove Alerts on the Daybook subscription (Admin says where).

## 4.0.5 — 13 October 2026

- **Photos and videos from a phone**: picked photos and videos show at once as grey tiles, and
  each turns into its picture as it is ready, instead of nothing happening for seconds. Each photo
  is read once, not twice, and made smaller without freezing the page.
- **Sending**: Add shows Sending… and cannot be pressed twice, so one tap is one entry.
  A video upload shows how far it has got (Uploading video 1 of 2 · 45%) until it is done,
  where before a note faded after three seconds.
- **iPhone**: tapping a text box no longer zooms the page in and leaves it zoomed. Pinch to zoom still works.

## 4.0.4 — 13 October 2026

- **Tags in Log**: typing # offers the tags already in use, most used first, under the box
  (and under the diary and each entry); #si narrows them to #site and #siemens. A tap, or Tab,
  finishes the word, and a tag already in the text is not offered again.
- **Rename a tag**: Log → Tags → Rename fixes a typo (#sit) in every entry at once. A name already
  in use merges the two (#pump3 into #pump-3). Undo puts every entry back.

## 4.0.3 — 13 October 2026

- **Suggest a change**: Help → Suggest a change, on any page, writes down what you would change,
  with where you were (the app, the page, the window's size, the version). Admin → Suggestions
  lists them; **Copy the open ones** to paste to whoever changes Daybook, and tick each off as Done.

## 4.0.2 — 13 October 2026

- **What's new**: Help → What's new shows this list, newest first. The first time Daybook
  opens after an update it says so, with a button to see what changed.
- **iPhone widget**: Admin → Calendar feed and phone → Phone widget → Copy script, for the
  Scriptable app: Home's figures on the Home Screen (safe to spend, payday, hours this week,
  last payslip, Learn due and streak, today's Log). Read-only, by its own key; tapping it opens
  Daybook.
- **Log Shortcut**: Admin spells out the Shortcut's steps with your key filled in.

## 4.0.1 — 13 October 2026

- **Menus**: tapping File, Edit or another menu no longer lights up Help as well. On a phone a
  submenu opens in place, with a ‹ row to go back.

## 4.0.0 — 13 October 2026

- **Phase 2: easy learning** (the plan doc "Daybook review and plan"):
  - **Lesson text is verbatim** (SPEC.md §1): a lesson keeps its author's words; Daybook adds
    beside them and never rewrites. The nine lessons adapted from OpenStax earlier each link
    **The original**, the section word for word.
  - **Open textbooks in, as published**: `daybook.py learn-import` brings OpenStax sections in
    from their source (CNXML on GitHub) with their own maths (MathML) and figures: seven A-level
    lessons (coordinate geometry, sequences and series, the binomial theorem, exponentials and
    logarithms, integration, numerical methods, vectors). Track 4 now has 10 of its 11 stops.
    OpenStax's licence is CC BY-NC-SA 4.0 (it was wrongly given as CC BY 4.0).
  - **Tracks and a skill map** in place of the Tree: six tracks, each a project at work, as a
    line of stops (proven, learned, fading, going, ready, needs, not written). A track that
    needs an unwritten lesson is blocked, not timed. **Prove it**: a bench task done and logged.
  - **Learn home**: Continue (the next part and its minutes), three short starts, the week as
    days, minutes, learned and proven. A rough level per subject the first time.
    Five pages in the menu, the rest under More.
  - **Lessons in parts** of 5 to 8 minutes, with a pause between; never between an idea and
    its question. Only the part you are in shows its ticks.
  - **Feed**: new cards from one lesson at a time; a refresher only from what you studied; a
    missed numeric card comes back with new numbers; your level shows after about 8 answers.
  - **Fifteen new lessons** where the outline was empty: Electronics (sensors and signals,
    diodes and rectifiers, test gear), Mechanical (gears, belts and chains; stress and strain),
    NDT (the six methods; immersion testing), Materials (properties; welding and weld
    defects), Software (Python for engineers; Linux and services), Fluids (pneumatics;
    hydraulics; pumps, fans and the affinity laws) and Instrumentation (P&IDs and ISA
    symbols). Written for Daybook, so no source text is reworded; each names its sources.
  - **Sixteen more**: Maths (proof, kinematics, forces and Newton's laws, complex numbers and
    phasors), Physics (potential dividers, capacitors, refraction and Snell's law, attenuation
    and decibels), Electronics (transistors as switches, digital logic, PWM, ADC and DAC) and
    Drives (braking and regeneration, parameter sets and fault finding, inertia matching,
    homing and limits). Track 4 (A-level pure) now has every stop written.
  - **Machines to run in lessons** (the `sim` widget): a simulation engine, a plain WebGL 3D
    view (no library) and a panel with a real control for every input, so a lesson can put a
    PLC, a drive, a motor, sensors or a whole small line in front of you and let you work it.
    A scene is plain JSON; a card reuses one and changes only what it needs. Two new questions:
    **goal** (make it do something: checked by a formula, three goes, Show me plays the
    author's solution) and **diagnose** (one of the scene's faults, picked afresh each review).
    The content check builds every scene, runs every fault and proves every goal can be met.
    Six scenes: a conveyor on a VFD under a PLC, a drive test bench (flywheel, load brake, brake
    resistor), a DOL motor starter with its control circuit as a live ladder, a servo axis with
    homing and limits, a reject sorter (colour sensor, timed pusher, counters) and a tank level
    loop (4–20 mA, S7 counts, PID, trips). 26 cards in 13 lessons use them, across drives, PLC and
    instrumentation lessons. How to write more: the Machines section of CONTENT-BRIEF.md.
  - **Quicker and smoother on the Pi**: a page names its files under the code's version, so
    the browser keeps them and opening an app again asks only for its data (about 1.5 s to
    0.4 s on a phone link); every module is listed up front and replies are gzipped. The theme
    is on the page as it arrives (no flash of the default), and moving between apps fades
    across with the bars held still. Learn's Today and feed are 4 to 8 times quicker.
  - **Log: + adds photos and videos** from the phone's library (the camera still takes a photo
    there and then). Videos up to 60 MB, kept as they came and played from the Pi in pieces;
    deleting an entry keeps its videos 30 days so Undo brings them back.
  - **Learn on a phone**: the calculator and whiteboard sheet pushes the question up instead of
    covering it, can be dragged taller or shorter, gives the board its room, steps aside on an
    explanation and closes when you leave the cards.
  - **Hours on a phone**: + Hours is a small form with your usual times; it will not add a shift
    that overlaps one already there.
  - **Learning record** (CPD) by day, as CSV.
  - **The workbench**: calculator and whiteboard as tabs in one docked panel (a sheet on a
    phone), 36 px labelled tools, the card's numbers as buttons, sums kept with the card, units
    through sums, fractions, hex and binary, `n!`, radians on graphs, Solve for any letter;
    straight lines and text on the board, Clear with undo.

- **Phase 1: always there, everywhere** (the plan doc "Daybook review and plan"):
  - **On the Pi in one command**: `sudo python3 daybook.py install --service` finds the Pi's
    Tailscale name, writes, enables and starts the systemd service, and points Tailscale's
    HTTPS at it; it refuses while the password is "pass" and never writes suite.db as root.
    `--backup-dir` sends the daily copies to a USB drive.
  - **A front door per app**: `/hours/` (Hours and pay) and `/spending/` (Spending) are two doors
    on Money's one database, each with its own menu, manifest and icon; the bar's tabs are
    Home, Hours and pay, Spending, Log, Learn. Each installs on the phone (Add to Home screen) and
    in Edge as its own app.
  - **The PC and laptop open the Pi**: `daybook.py install --url https://pi.…ts.net` makes a
    Start menu shortcut per app, each its own window, taskbar group and icon (`Daybook.pyw log`);
    **Ctrl+Alt+L** opens Log ready to type in.
  - **Kept signed in while used** (the cookie renews itself; 30 days unused and it asks again);
    `SameSite=Lax`, so a link to Daybook clicked in Outlook arrives signed in.
  - **Switching app is quicker**: the page's files are revalidated (ETag, 304), not re-sent.
  - **Log keeps what you are writing** across switching app or a reload; leaving with photos
    or voice unsent asks first. On a computer the box is ready to type in.
  - **Set up Daybook** on Home: password, pay, accounts, hours, your level in Learn, each ticked
    from what is there and each a button; empty pages offer the button too ("Add an account").
  - **Updates take the newest release** (a tag), so a half-made change on main never reaches the
    Pi; `DAYBOOK_UPDATE_BRANCH` follows a branch instead.
  - **A server left running makes each day's copies** (the first visit of a day starts them);
    before, an always-on Pi copied its databases only when it started.
  - **Frame**: grey text now 4.5:1 or better in every theme; the menu lists each thing once;
    Alt+1… switches app; "Search every app" opens the item itself in its app; links take the
    app's colour, not the browser's blue.

- **Phase 0 of the review** (the plan doc "Daybook review and plan"):
  - **XP, rank, badges and daily quests are gone**: they counted clicks, not learning.
    Today shows the week in minutes, days studied and lessons learned; the `badge` table
    goes (Learn migration 006); apps/learn/gamify.py is now skilltree.py.
  - **A lesson is learned wherever its check is passed**: the feed and Review count, not
    only the lesson player; a flash says so and what it opened.
  - **One broken lesson file no longer stops Daybook**: it is left out and named on Today;
    the rest loads. The desktop window says why if anything else stops it starting.
  - **Answers take SI prefixes** (4.7k, 470µ, 4.7 kΩ on a kΩ card; a bare m is milli only
    where the unit makes that plain).
  - **Whiteboard and calculator dock beside the card** and the page makes room, so they
    never cover it (1024×768 too); drag one out to float it, Dock puts it back. Alt+W and
    Alt+C work while typing an answer. Ctrl+Z after drawing undoes the drawing, not
    Daybook's last saved change.
  - **Widget readings that would give the answer away stay hidden until you answer**
    (`"hide": true` on a widget card; 12 circuit and motor cards).
  - **Send to HR as a real table**: date, start, finish, overtime; weeks from Monday, each
    its own colour, with its overtime; the month's at the foot. Copy as table (HTML for
    Outlook and Gmail, tab-separated text for Excel), Open as Outlook draft (.eml), CSV.
    Its own month picker, defaulting to the last full month.
  - **Imports for his banks**: Nationwide (the payee is no longer "Visa purchase"; old
    layout too), Santander's statement .txt, QIF. Overlapping exports skip rows already in
    the account; opening and closing balances come from the balance column.
  - **Expected pay on a new payslip** compares with the hours it pays for (the month before
    its pay date), not the page's month.
  - **Plan 2 student loan threshold for 2026/27 is £29,385** (Money migration 004).
- **Skill tree** (branch SkillTree; PLAN-SKILLTREE.md): Learn → Skill tree draws each subject as a
  map, stages across and units down, prerequisite lines between lessons, each lesson marked
  solid / learned / in progress / ready / needs more first / not written. A lesson's panel shows
  what it needs and opens. A **goal** (any lesson) turns the tree into a numbered route; Today
  shows it with the next step. Finishing a lesson lists what it unlocked. Never locks.
  (XP, rank, badges and daily targets came with it and went in Phase 0, above.) Checks: tests/test_skilltree.py, tests/tree.check.mjs.
- **Calibration banks reviewed**: one wrong question fixed, ~20 marking and feedback fixes, ~17
  level misfits, and the right option is no longer the longest in two thirds of questions (now
  about a third); the check also flags a giveaway in banks (right option the longest, >1.2× the
  mean wrong one and >8 characters past the longest wrong one).
- **Nine more lessons from OpenStax (CC BY 4.0)**: AC power, measures, shapes, algebra and
  functions, trigonometry, charge and current, resistance, series and parallel circuits,
  alternating current. The content check now fails a card with a control character (a lone
  backslash in TeX).

- **Sync between computers** (core/sync.py): each computer keeps its own databases and
  works offline. Changes are captured by triggers and written to encrypted files of each
  computer's own, in a folder they all reach (OneDrive, Google Drive, USB, a NAS) or a
  private GitHub repository; each computer applies the others'. Newest change per field
  wins; a value that lost goes to Change history, where Undo brings it back. Admin → Sync
  between computers, or `daybook.py sync`. Checks: tests/test_sync.py. Tried on the demo
  data: a second computer joins and every row of every table matches, to the last digit.
- **Update from GitHub** (core/update.py): Admin → Daybook version, or `daybook.py update`.
  The code lives on GitHub, so it can be changed from anywhere; each computer takes the
  newest commit's code and puts it in place. data/, backups/ and a portable python/ are
  never touched; code older than the databases is refused; the code replaced is kept, and
  `daybook.py update --rollback` puts it back. Checks: tests/test_update.py.
- **Whiteboard and calculator beside every card** (apps/learn/web/tools.js, calc.js): W and
  C, or the card's links. One board per card, kept in learn.db (migration 003, `sketch`)
  and offered as "your working last time" when the card comes back. The calculator runs
  the formula engine with SI prefixes, degrees or radians, ans, engineering notation and
  "Use this answer". Docked on a wide window, a bottom sheet on a narrow one; no floating or
  popped-out windows (add them if docked proves too tight). Checks: tests/calc.check.mjs.
- **More ways to make it stick**: *predict, then see* on widget cards (the controls unlock once you
  have guessed); *explain the step* (say why in your own words, then the model answer and its key
  points); *spot the mistake* (working, rungs or code with one line wrong). *Bench tasks* at the end
  of a lesson, with a checklist and a line for today's Log. *Listen*: a lesson's summary read aloud,
  at the lesson's end and on Notes. The card table loses its CHECK on type (migration 004): the files
  are checked as they load, so a new kind of card needs no migration. Ohm's and Kirchhoff's laws has
  one of each. Written up in CONTENT-BRIEF.md; checked by tests/content.check.mjs.
- **Courses from elsewhere** (apps/learn/packs.py; My cards → Courses from elsewhere): Anki decks
  (basic, reversed and cloze notes, pictures, MathJax), Moodle XML and GIFT quizzes (multiple
  choice, true/false, numerical with tolerance or range, matching, short answer) and Daybook course
  packs become subjects in data/courses/, loaded with the courses on every start; each says where it
  came from and asks you to check its licence. Re-importing keeps progress; any subject downloads as a
  pack. QTI, H5P and open-textbook readings are left for later. Checks: tests/test_packs.py.
- **Trading 212 CSV** (apps/money/t212.py; Savings/Pension → Import a Trading 212 CSV): deposits and
  withdrawals recorded as money paid in and taken out, each once (by Trading 212's id); dividends,
  interest and trades counted and shown. Undo takes an import back.
- **Ladder widget** (apps/learn/web/widgets/ladder.js): rungs written as Boolean logic, drawn as
  contacts and coils with power flowing in colour, on the same PLC interpreter as the ST cards:
  series, parallel branches, normally closed and edge contacts, set/reset coils, timers and
  counters, push-buttons that are on only while held, and the program shown as ST.
- **Lessons**: PLC ladder basics (contacts, coils, seal-in, why stops are wired normally closed,
  set/reset), timers and counters (TON/TOF/TP, retentive timers, CTU/CTD), edge detection (R_TRIG,
  F_TRIG, P/N contacts, edge memory, the first scan). Pulse-echo gets "Explain it another way" and
  hints throughout.
- **Curriculum batch 1**: eleven more subjects outlined (Electrical, Control and Instrumentation,
  Machine Safety, Networks, Mechanical, Fluid Power, Materials, NDT, Software, Professional Practice,
  Other Disciplines: 236 lessons in all), new lessons in the Maths, Electronics and Drives outlines,
  and six starred lessons written: safe isolation (EAWR, GS38, prove-test-prove), proximity sensors
  (inductive, capacitive, photoelectric, PNP and NPN), IP addressing and subnets, reading schematics
  (IEC symbols, terminal numbers, cross-references), fault finding (evidence, half-split, one change
  at a time) and fasteners (property classes, threads, torque and preload). Each has an explain card,
  a spot-the-mistake card and a bench task.
- **The whiteboard and calculator are windows**: drag each by its title bar, resize it from the corner,
  have both open at once; each comes back where it was left. (They were one panel pinned to the
  right, one tool at a time.) The calculator is a real one: pressable keys as well as typing, Shift
  for the inverse functions; **Graph** plots up to three functions of x (drag, zoom, read values,
  fit); **Solve** finds every root of an equation in x in a range and graphs it. Implicit times (2x,
  3sin(30), (1+2)(3)) and −2^2 = −4, as a calculator reads them. Built on the formula engine, so it
  works offline; Desmos and GeoGebra would need the internet (and Desmos a key).
- **Calibration banks** for all sixteen subjects, 643 questions (3 or more per outline lesson), so
  Find my level works everywhere. The first five were reviewed (rounding that marked right answers
  wrong, tolerances, placeholders inside maths, levels).
- **Multiple choice** no longer gives the answer away: across every bank and lesson the right option
  was usually the longest; options are rebalanced, and the content check now fails a right option
  much longer than every wrong one.
- **Bank questions are not lesson cards**: an unwritten lesson shows as Not written yet (it showed
  "3 cards"), "start here" after placement points at a written lesson, and subject and lesson
  progress count only the lessons' own cards. On **Courses** a subject with nothing written yet
  starts closed.

Still to check: the resource links in the six batch-1 lessons were found by web search but not
opened (the build machine's network blocks those sites). Open each once and replace any dead one.

## 3.0 — 28 September 2026

Opens a 2.2 database and moves it on (Money migrations 002 and 003, Learn 002). All
tests pass. Checked in a browser at desktop, half-screen and phone widths: the savings
and investments groups, reading a statement PDF, moving a contribution to another
pension, time off in lieu, the lesson player, Formula help, dragging order cards, Find
my level, Checkpoint and Test out.

Done:
- **Savings and investments**: savings count whether known by a statement or only by a
  valuation. One list, grouped Savings / Investments / Pensions, each group and account
  opening and closing (remembered), with its valuations inside. Adding a valuation starts
  on "Choose the account" and offers pensions too.
- **Money put away**: payments in and out of savings, investments and pensions, typed in,
  changed or removed. On the Pension page every contribution says where it came from: a
  payslip (open it, or move it to another pension), a statement, or typed (remove it).
- **Statement PDFs**: Read a statement PDF fills in the value, the date and the account;
  Trading 212 first, and most statements that label their figures. Deposits less
  withdrawals can be recorded as money paid in; the PDF is kept with the valuation.
  Built against Trading 212's labels without a real statement: send one if it misreads.
- **Time off in lieu**: hours earned are kept per leave year and become days in the
  allowance; days booked as time off in lieu come off what is left. The old totals moved
  to this year.
- **Learn**: order cards drag with mouse and finger. Formula help on every card with maths
  (what the formula says, each letter, how to read the notation) and a Formulas page;
  "Explain it another way" and hints. FSRS scheduling, levels on our own 1–9 scale with
  RQF alongside, calibration, struggles that come back, the staged lesson player, notes.
- **Lessons**: Maths Foundations (7), Ohm's and Kirchhoff's laws, and the 5 older lessons
  rewritten in stages (PID now explains derivatives and integrals in plain words first).
  Drives: induction motors and slip, V/f and vector control, DC drives, servo motors and
  amplifiers, encoders and resolvers, motion profiles.
- **Courses**: each lesson is a card that says where it stands: Learned, In progress, Not
  started (with its length) or Not written yet, with a mark as well as the colour. Show all,
  written, to do, in progress or learned (remembered); each unit and subject counts them.

The PLC lessons (ladder, timers and counters, edges), the calibration banks and pulse-echo's
extra help were finished alongside 4.0's first parts (above). The rest of Drives (tuning,
feedforward, gearing, homing, inertia, braking, parameters) moves to the curriculum batches.

## 2.2 — 23 September 2026

No database changes: an existing database opens as it is. On first start the
bank holidays from 2000 to five years ahead are filled in where a year has
none, and sort codes are tidied to 20-45-77 with their bank.

- **Payslips**: a new payslip is marked New and a saved one Saved, with Save at
  the top and bottom (Save changes stays off until something changes). A new
  payslip can no longer land on a saved one's date and replace it; a red line
  says so and offers to open that one. A payslip overwritten before this can be
  got back from Change history. Lines start empty (no 0.00 to delete),
  basic pay and the overtime rates come from your salary as grey hints that are
  saved if left, Enter goes box to box, and the month worked follows the pay
  date. Leaving a payslip with changes asks first.
- **P60s**: a log of every tax year's P60 beside its payslips, with a P60 mark
  per tax year in the payslip list.
- **Hours**: the new row's start and finish are your usual ones from the last
  30 days, used if left.
- **Annual leave** (was Holidays) and **Time off in lieu** (was Extra hours).
  The year steps back and on in the page header, as far as you like; bank
  holidays are worked out for any year, one-off days included.
- **Log calendar**: a year back or on, or straight to any month.
- **Sort codes**: 20-45-77 however typed, and the bank named from them.
- **Home and Overview**: figures, bills and log entries open what they show
  (the last payslip opens that payslip; a log entry opens its day, marked).
- **Panels of your own**: the data by name with a line on what a row is, a few
  rows of it to see each column, pickers that only offer columns that fit, and
  a second source joined on a shared column. Header and body colours are set
  separately.
- **Split screen**: the layout follows the page's width rather than the
  screen's, so half a screen gets paired small panels and full-width large
  ones; below 900 px the sidebar is a drawer and the apps stay in the top bar;
  the phone tab bar is for phones only. Tables scroll inside their panel rather
  than squash their boxes.

## 2.1 — 22 September 2026

- **A window again, not a browser.** The launcher opens Daybook in app mode (no
  tabs, no address bar) with its own taskbar icon, name and pin; the apps switch
  inside that one window.
- **Icons**: a Daybook icon (sharp at 16 px, detailed from 48) and one each for
  Money (£), Log (a timeline) and Learn (a card), on the taskbar, Home screen
  and install.
- **One bar along the top**: the apps, search, Undo, Customise and ☰ for the
  menu (File, Edit, View, Go, Help, Theme, Admin, Lock). The menu bar and the
  period strip are gone; the period sits in each page's header.
- **Each app looks its own**: Money green and figure-led, Log a journal (serif
  day title, a composer, a timeline of entries), Learn indigo with a progress
  hero and subject cards. Calmer panels: rounded, no grid lines, controls on
  hover. Phones get a tab bar along the bottom and the pages in a drawer.
- **Customise** saves as you go: quick widths, hide a panel, an Add-a-panel
  drawer with every panel of the app, the page's width, Reset. In the sidebar:
  reorder, hide and rename pages, and add or delete pages of your own.
- **Home**: Arrange orders the cards, makes one wide or hides it; a greeting.
- Wireframes of every main page, Customise and the phone are in the design
  board that came with this release.

## 2.0 — Daybook — 22 September 2026

Finances becomes **Daybook**: three apps in one window. It starts from a clean
data folder; nothing is carried over from Finances.

### The suite
- **Money, Log and Learn**, one server, a database each (`data/money.db`,
  `log.db`, `learn.db`), and `suite.db` for what they share: the password,
  themes, the keys, which database each app uses.
- **One password for everything**, `pass` until changed. A sign-in page, a
  30-day session, and a red line across the top while it is still `pass`
  (until then only this computer is answered). Changing it signs every other
  device out.
- **Home** (`/`): a card for each app. **The app switcher** in the menu bar
  (and the side panel on a phone) goes between them, reusing the tab if it is
  open. The launcher opens one window with Money, Log and Learn as three tabs.
- **Calendar feed**: a private address for your phone's calendar or Outlook
  with bills and amounts, paydays, days off, bank holidays and Learn's review.
- **Phone**: Android can share photos and text into Log; an iPhone Shortcut can
  post a note with the phone key. Notes for Tailscale's HTTPS in the README.
- **Raspberry Pi**: `daybook.py install --service` writes a systemd unit;
  `DAYBOOK_URL` makes the launcher open the Pi's Daybook instead.
- Backups: a database over 200 MB is copied weekly (8 kept) instead of daily.

### Money
- Everything Finances did, less the work log (now Log).
- **Safe to spend** on the Overview: type the balance and its date; less the
  bills before payday and what you set aside, what is left, and per day.
- **Receipts**: a photo or PDF on any payment. One added before its payment
  arrives waits, and is offered to the payment that matches it.
- The timesheet links each day to that day in Log.

### Log (new)
- A diary of the day and the work day: entries with times, tags, photos (shrunk
  to 1600 px, pasted or dropped) and voice notes. The day page shows that day's
  shifts from Money. Timeline, calendar, tags, search, printing.

### Learn (new)
- **Feed** of full-screen cards with swipes and keys, a daily goal ring, and a
  summary every 20 cards. **Courses** with Continue, prerequisites and mastery.
  **Review**, **Practice**, **Stats** (heatmap, accuracy, mastery, hardest
  cards), a **study timer**, **your own cards** and a CSV import. Wrong answers
  become flash cards.
- Nine card types, spaced repetition (SM-2), question templates with random
  numbers, maths notation (TeX to MathML), a Structured Text interpreter.
- Widgets: pulse-echo A-scan, acoustic impedance, PID loop, function grapher,
  the PLC scan cycle.
- The outline of five subjects (87 lessons), and five lessons written:
  pulse-echo, acoustic impedance, the scan cycle, PID, differentiation.
  The rest, and the remaining widgets, come later.

### Fixed
- A table filter with an empty value (`?txn_id=`) was dropped, so it matched
  every row; it now means "is empty".

## 1.6 — 22 September 2026

The database upgrades itself on first start (migration 009), after a backup.

### New
- **Search everything.** A box at the top (or press `/`) searches transactions,
  payees, shifts, the work log, payslip lines, days off, reminders, accounts and
  categories. Words can come in any order; a number such as `24.99` also finds
  that amount. Click a result to go to it.
- **Reminders and regular bills.** A Reminders page and a Coming up panel on
  the Overview. Bills, renewals, anything that comes round: once, weekly,
  monthly, quarterly or yearly. Tie a bill to a payee and it ticks itself off
  when the payment goes out; anything else, press Done. Regular payments found
  in your statements are listed with a Track button; nothing is added until you
  press it. The page shows what your regular bills cost in an average month.
- **End of tax year check** (Pay page). The year's payslips added up beside the
  P60 you type in, with the difference on each line; the months with no
  payslip; and what the year's pay should have cost in tax, so an overpayment
  shows. A yearly reminder for 31 May is already set.
- **Switch databases** (Admin → Databases). Open another file, such as last
  year's or a copy to try things on. Before it opens you see what is in it and
  whether it is damaged or from a newer version, and you type its own admin
  password. The one you leave is backed up. It opens next time too, and its name
  shows at the top whenever it is not your usual `finances.db`. Make a new empty
  database, or a copy of the open one, from the same panel.
- **Phone access.** The server now accepts being reached by address (your
  Wi-Fi or Tailscale address), and `--allow-host` adds a name such as your
  Tailscale machine name.
- **Menu bar**: File, Edit, View, Go, Help, with the keys shown beside each
  item. View has the theme and period length; Go has every page.
- **Right-click menus**, for what is under the pointer:
  - a shift: log and photos, the same shift today or the next day;
  - any editable row: duplicate it, delete it;
  - any table: copy the cell, the row, or the whole table for Excel; save it as CSV;
    search for what is in the cell; everything from that payee; other payments
    of the same amount;
  - a chart: copy it as a picture, or save it as one;
  - a link: open it in a new window;
  - a panel: refresh it, fold it, edit the layout;
  - selected text: copy it, search for it.
  Shift+right-click still gives the browser's own menu, and text boxes keep it.
- **Keys**: `/` search, `[` and `]` previous and next period, `T` today,
  `Ctrl+Z` undo (outside a text box), `?` the list.
- **The sidebar in groups**: Hours (Hours, Pay, Holidays), Spending (Spending,
  Accounts, Reminders), Investments, Logs, Setup.
- **Investments page**: savings, investments and pensions added up, valuations,
  value over time.
- **Work log** and **Change history** pages, under Logs.
- **Randomise colours** in the theme editor: random colours that still read
  well. The accent is picked by a colour-wheel rule (opposite, a third round,
  split, next door); text, money and chart colours are pushed lighter or
  darker until they pass a contrast check against the background, so a chart
  line can never vanish into it. Fonts and table choices are left alone.

### Changed
- Saving no longer makes the page jump. A panel keeps what it showed, at the
  same height, until its new content is ready; a whole-page redraw keeps the
  page's height and your place until the panels are back.
- A new theme starts from the theme in use, and the page no longer switches
  to Paper when you press New theme.

### Fixed
- Pension settings: choosing "The first pension account" failed with "NOT NULL
  constraint failed". A cleared setting is now kept as empty.
- A panel could show the word "null" under its content.

## 1.5 — 22 September 2026

Unzip over the old folder. The database upgrades itself on first start
(migration 008) after taking a backup; nothing to do by hand.

### New
- **Runs as an app.** `python finances.py install` adds Finances to the Start
  menu and desktop with its own icon. It opens in its own window (Edge app
  mode), and the server stops when the window closes. Pin it from its taskbar
  button. `finances.bat` still starts it from a USB stick.
- **Work log with photos.** A Log button on every shift: notes, photos (shrunk
  to 1600px and kept in the database), or a pasted screenshot. Thumbnails sit
  beside the shift; the Work log panel lists the period's entries.
- **Pension.** A Pension account kind. Payslip pension lines (yours and your
  employer's) and bank payments land in it; valuations give growth. The annual
  allowance left is shown (£60,000 for 2026/27).
- **Formulas on any table or chart** (admin): add columns and total rows like
  `DAYNAME(Date)`, `SUM(Hours)`, `SUM(2026.May.Hours)`, `This.Overtime`, with
  suggestions as you type and a preview of the result.
- **Themes.** Build your own in Admin → Themes: every colour, font, text size,
  row spacing, corners and table look, previewed live. Pick the theme from the
  list at the top right; the choice is saved in the database.
- **Reword anything.** Admin → Edit text, then click a heading, label or button.
- **Account colours**, used for the dots in lists and slices in charts.

### Pay
- Each payslip line has **Counts as** (Basic, Overtime ×1.5, Overtime ×2, Tax,
  NI, Pension…); the totals use it.
- Units × Rate fills the Amount; type over it if the slip differs.
- New payslips always have both overtime lines, filled from the timesheet.
- Expected splits overtime into ×1.5 and ×2, and shows the hourly rates.
- **My details**: works number, tax code, NI number and table, student loan
  plan, employer PAYE reference.
- Amounts accept commas as thousands: `24,000` is twenty-four thousand, and
  money boxes show `24,000.00`. The same goes for every number box.

### Holidays
- Its own year picker, separate from the period in the header.
- Type days off as written: `8-12 Sep`, `25th April`, `27-28 Nov`, `25/04`.
  Working days are counted for you (Mon–Fri, less bank holidays); type over
  them for half days.
- Types: Holiday, Extra hours, Other. Only Holiday comes off the allowance.
- Every year in one table; a new year copies last year's allowance.
- Extra hours earned and used as text boxes. Past days struck through.
- Bank holidays shown with the years side by side.

### Hours
- Option to take short weekdays off overtime, as the old pay sheet did
  (Settings → Overtime rules). Default stays per day.
- Contract hours 39 a week, so £26,000 gives £12.82 an hour.

### Editing layouts (admin)
- The dashed outline is the handle. Drag a panel by its title bar or top/left
  edge to move it; drag the right or bottom edge, or the corner dot, to resize.
  A label shows the width and height as you drag. Double-click the bottom edge
  for automatic height.
- Resizing follows the pointer both ways (it used to run away downward).
- Moving and resizing no longer redraw the page, so it stays where you are.
- Clearer buttons: ◀ Earlier, Later ▶, a named Width list (Quarter, Third,
  Half…), ⚙ Settings, × Remove.

### Fixed
- Clicking a panel name in the sidebar broke that panel's layout.
- The header scrolled away on long pages.
- The theme reset each time the window was reopened.
- Pinning the window pinned plain Edge.
- The payslip overflowed the screen on a phone.
