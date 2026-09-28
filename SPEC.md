# Spec: Money · Log · Learn

A handover for the next developer (human or AI). It covers where this came
from, what exists, what is decided, and what to build next, in that order.
Read it all before changing anything. The code that goes with it is the zip
this file came in (version 1.6, unreleased; see `CHANGELOG.md`).

Contents
1. Who it is for, and the rules the work follows
2. What exists today (the Money app, v1.6)
3. What to build: one environment, three apps
4. The shared environment
5. Money
6. Log
7. Learn
8. Home, calendar feed and phone
9. Running it: Windows PC, USB stick, Raspberry Pi
10. Security
11. Checks and acceptance
12. Order of work
13. Lessons already learned (bugs not to repeat)
14. Open questions

---

## 1. Who it is for, and the rules

**The user.** Will: a controls and software engineer at a small UK systems
integrator (TS247, Stoke-on-Trent). PLCs, drives, SCADA, site work. Computer
Science degree. Studies A-level maths on his own and is building a controls
engineering curriculum. Uses Windows at work and home, a laptop on site, and a
phone. UK tax year, British English, dates as `dd/mm/yyyy`.

**Why it exists.** He kept finances and hours across many Excel sheets that
were a chore to maintain and could not show a whole year at once. He wants one
place for hours, pay, tax, holidays and spending; a diary of his days; and
learning that can replace idle scrolling.

**Rules that have held throughout. Keep them.**
- **Standard library only.** Python 3.9+ standard library and SQLite on the
  server. Plain ES modules in the browser, no build step, no npm, no framework,
  no CDN. Nothing loads from the network at run time (fonts are local files).
  It must run from a USB stick and on a Raspberry Pi as it is.
- **One file per database.** SQLite, rollback journal (never WAL: a yanked
  stick and a sidecar file do not mix). Forward-only numbered migrations.
  Views are rebuilt from source on every start.
- **"Don't make it too smart."** Explicit over inferred. A balance is the
  closing balance typed from the statement, not a computed one. Transfers
  between his own accounts are linked by hand. Anything the app detects (a
  regular payment, say) is only *suggested*; nothing is added until he presses
  a button.
- **Everything editable, everything undoable.** Every table is edited in place
  (click, type, leave). Every write records how to reverse itself; Undo in the
  header and a Change history page.
- **No AI-sounding text.** Plain, short labels in British English. No
  "insights", no chatty helper text, no emoji decoration in the UI.
- **Lazy code ("ponytail").** The least code that works. Standard library and
  native browser features first. No abstractions with one user. Deliberate
  simplifications carry a `ponytail:` comment naming their limit. Every piece
  of non-trivial logic leaves one runnable check behind (see §11).
- **Commas are thousands.** `24,000` is twenty-four thousand everywhere a
  number is typed.
- **Pages must not jump.** Saving or refreshing keeps the page where it was.

---

## 2. What exists today (the Money app, v1.6)

Everything in this section is built and passes its checks. Treat it as the
starting point: the plan in §3 is a restructure, not a rewrite.

### 2.1 Files

```
Finances.pyw            the app: starts the server, opens the window, stops when it closes
finances.py             CLI: serve | check | import | backup | export | adopt | install
finances.bat/.command   start from a USB stick (finds a portable Python in ./python)
demo.py                 builds a demo database: python3 demo.py demo.db
app/db.py               connect, migrations, integrity check, backups, last-database.txt
app/api.py              every endpoint; generic table/view API; undo; admin tools; search; DB switching
app/server.py           HTTP server, the doors (Host/Origin/header/token), admin sessions, static files
app/views.sql           every derived number as a view, rebuilt each start
app/importer.py         bank statement CSV import: plan (preview) then commit
app/timesheet.py        hours import (Clockify, spreadsheets) and the HR sheet export
app/matching.py         description normalising and payee rules
app/tax.py              PAYE/NI/student loan/pension estimate; month and year estimates; end-of-year check
app/reminders.py        next-due dates, bills ticked off by payment, regular-payment suggestions
migrations/001…009      schema, forward only
web/index.html          the shell: menu bar, header, sidebar, main
web/core/               router, layout (panels), api, dom helpers, state/period, format,
                        formula engine, commands (menus/keys), text (rewording)
web/ui/                 tokens.css, chart.js (SVG charts), grid.js (editable tables),
                        calendar.js, fx.js (formula box), tablefx.js (columns/rows on any table),
                        shiftlog.js (work log + photos), menu.js, palette.js (random themes)
web/views/              one file per page
tests/test_finances.py  the Python check (≈870 lines)
tests/formula.check.mjs the browser-logic check under Node
```

### 2.2 Shell and UI

- **Menu bar** (File, Edit, View, Go, Help) above a sticky header. The header
  has the period picker (week, month, 2 months, quarter, tax year, year, all;
  ◀ ▶, Today), quick buttons (+ Hours, + Payslip, + Statement), a search box,
  Undo, a theme list, and admin buttons when signed in.
- **Sidebar** in groups: Overview; Hours (Hours, Pay, Holidays); Spending
  (Spending, Accounts, Reminders); Investments (Investments, Pension); Logs
  (Work log, Change history); Setup (Settings, Admin). Under the current page it
  lists that page's panels; clicking one scrolls to it and outlines it briefly.
- **Pages are panels on a 12-column grid.** Built-in panels are registered by
  id (`hours.timesheet`); a page's layout is a list of panel configs. Generic
  panel types: chart, table, tiles, text over any view. Each panel declares
  the tables it depends on and refreshes when one changes. A refresh keeps the
  old content and height until the new content arrives (no jumping).
- **Charts**: own SVG code. Bar, stacked, line, area, rows (horizontal),
  pie/donut, table. Buttons to switch type, grouping and range. Series beyond 6
  fold into "Other". Account colours are used where a chart splits by account.
- **Editable grids** (`grid.js`): every cell a text box that saves on leaving;
  Enter moves down; an empty row at the bottom adds. Row delete with Undo.
- **Right-click menus** for what is under the pointer: a shift (log and
  photos, the same shift today/next day); any editable row (duplicate,
  delete); any table (copy cell/row/table as TSV for Excel, save as CSV, search
  the cell, everything from that payee, other payments of the same amount); a
  chart (copy or save as PNG); a link (open in a new window); a panel (refresh,
  fold, edit layout); selected text (copy, search). Shift+right-click and plain
  text boxes keep the browser's own menu.
- **Keys**: `/` search, `[` `]` previous/next period, `T` today, `Ctrl+Z` undo
  (outside a text box), `?` the list.
- **Search** across transactions, payees, shifts, work log, payslip lines,
  days off, reminders, accounts, categories. Every word must match somewhere; a
  number also matches that amount. Results grouped, words marked, click to go.
- **Themes**: Paper, Dusk, Ink built in, plus Auto. Custom themes in
  Admin → Themes: every colour token, fonts, text sizes, row spacing, corners,
  table look (clean, lines, striped, grid, sheet, boxed), previewed live on the
  whole app. **Randomise colours** (`palette.js`) picks a page hue and an accent
  by a colour-wheel rule, then pushes text, money and chart colours lighter or
  darker until they pass contrast (text 7:1, secondary 4.5:1, charts 3:1). The
  choice of theme is stored in the database (browser storage was being wiped).
- **Rewording**: Admin → Edit text, click any label, type a new one.
- **Layout editing** (admin): the dashed outline is the handle. Drag by the
  title bar or top/left edge to move; right/bottom edge or corner dot to
  resize (sizes run from the drag start); double-click the bottom edge for
  automatic height. Buttons: ◀ Earlier, Later ▶, Width (Quarter…Full),
  ⚙ Settings, × Remove. Per-panel colour, table look, font, text size, height.
- **Formulas on any table** (admin): add columns and total rows, e.g.
  `DAYNAME(Date)`, `IF(Hours > 8.5, Hours - 8.5, 0)`, `SUM(Hours)`,
  `SUM(2026.May.Hours)`, `This.Overtime`, `TY2026.Tax`. A safe Pratt parser
  (no eval) with ~45 functions (SUM, SUMIF, COUNTIF, IF, IFERROR, ROUND,
  RUNNING, PREV, DAYNAME, WEEKNUM, HOURS, HHMM, MONEY, WORKDAYS, TEXT…).
  Period figures (`2026.Q2.Spent`) resolve on the server through `/api/measures`.
  Autocomplete, argument hints and a live preview in the formula box. Charts can
  take extra formula series.

### 2.3 Hours

- Shifts: date, start, end, project, note; a split day is two rows. `0730`
  becomes `07:30`. Calendar month view; click a day to add to it.
- **Overtime is per day**: Mon–Thu past 8.5 h, Fri past 7.5 h at ×1.5; all
  Saturday and Sunday hours at ×2 (table `day_rule`). Optional setting
  `ot_net`: short weekdays count against overtime, as his old sheet did.
- Hourly rate = `pay_rate.ot_hourly`, else annual ÷ (52 × contract hours);
  contract hours 39 (e.g. £26,000 → £12.82, ×1.5 = £19.23).
- Hours worked in a month are paid on the 17th of the next (setting `payday`).
- Pay-period cards (hours worked in a month against the payslip that paid
  them). "Send to HR" copies the month as Date/Started/Finished/Hours/Notes.
  Import from Clockify exports or spreadsheets.
- **Work log** per shift: text, time, photos (shrunk in the browser to 1600 px
  JPEG, thumbnail 240 px, stored as data URLs in `shift_log`, CHECKed to be
  JPEG), paste a screenshot. Thumbnails beside the shift; a Work log page.

### 2.4 Pay

- Payslip = header (`pay_date` key, worked month, tax code, NI letter, note)
  plus lines in groups Payments, Deductions, Employer, Year to date. Each line
  has a label, units, rate, amount and a **Counts as** code the totals use:
  `basic ot15 ot2 bonus tax ni pension student_loan er_ni er_pension`.
  Units × Rate fills Amount; typing over it wins. A new payslip copies the last
  one, dated the next payday, with both overtime lines filled from the
  timesheet.
- **Expected**: what the month's hours should pay (basic + ×1.5 + ×2), and the
  estimated deductions, beside the actual payslip with differences.
- PAYE estimate from rates in the database (`rate_band`, `tax_year_cfg`:
  personal allowance with the £100k taper; NI bands; student loan plans 1, 2,
  4, 5, postgraduate, rounded down to whole pounds). Pension relief: net pay,
  salary sacrifice, or relief at source. Check the rates each April.
- **End of tax year** panel: the year's payslips added up (taxable pay = gross
  less pension under net pay), beside P60 figures typed in, with differences;
  months with no payslip; the tax that pay should have cost over the year.
- **My details**: works number, tax code, NI number and table, student loan
  plan, employer PAYE reference (text boxes).

### 2.5 Holidays

- Own year picker (the header period does not apply). Calendar years.
- Days off typed as written: `8-12 Sep`, `25th April`, `27-28 Nov`, `25/04`,
  `30 Dec - 2 Jan`. Working days counted (Mon–Fri less bank holidays); type
  over for half days. Types: Holiday, Extra hours, Other; only Holiday comes
  off the allowance. Past days struck through.
- Allowance and extra days per year (a new year copies last year's). Extra
  hours earned/used as boxes. Bank holidays for England and Wales seeded to
  2030 (substitute days included), shown with years side by side.

### 2.6 Spending and accounts

- Accounts: current, savings, investment, credit, pension; colour; provider;
  joint accounts at a fixed share (50%).
- Statements imported per account (CSV): preview, pick columns, flip signs,
  then commit. Type opening and closing balances; it shows whether the rows add
  up; coverage gaps shown. The account balance is the typed closing balance.
- Payees and rules: descriptions normalised (card suffixes, dates, refs
  removed); rules exact/prefix/contains/regex with priority; a payee set by hand
  is locked. "To sort" lists unmatched payees biggest first; assigning one
  writes the rule (`Eating out · Coffee` creates the child category).
- Categories are a tree with kinds (spend, income, transfer, saving,
  interest, lending), budgets, drag to nest/reorder. Tags (a car, a trip, a
  person) across categories. Transfers between own accounts linked by hand and
  never counted as spending.
- **Reminders and bills**: once/weekly/monthly/quarterly/yearly from a first
  due date; months keep their day (31st → 28th → back to 31st). A bill tied to
  a payee ticks itself off when that payee is paid within 7 days of the date;
  anything else is ticked off with Done (`done_through`). Regular payments
  (steady interval and amount, still going) are suggested with a Track
  button. Coming up panel on Overview (reminders, days off, bank holidays).

### 2.7 Investments and pension

- Pension accounts: payslip pension lines (yours and employer's) and bank
  payments into them; valuations; growth; annual allowance left (£60,000 for
  2026/27). Investments page: savings, investments and pensions added up,
  valuations grid, value over time.

### 2.8 Admin (`/admin`)

Password (default `admin` today; see §10 for the change). Databases (open
another file after a read-only inspection and its password; new empty or a copy;
remembered in `last-database.txt`; the name shows in the header when it is not
`finances.db`), Themes, Pages (add your own, rename, reset), Columns (add `x_`
columns of any type or a SQL formula), Data (every table, editable, CSV),
SQL (reads on a read-only connection; writes back up first; save as a view),
Saved views, Backups (now, restore, download), Health, Password.

### 2.9 The server and data layer

- `GET/POST/DELETE /api/t/<table>` and `GET /api/v/<view>` for everything, with
  identifiers checked against the live schema and values always bound. Filters
  `col=`, `col__gte/lte/gt/lt/ne/like=`, `order`, `desc`, `limit`, `offset`,
  `search`. Special endpoints: payslip, estimate, import, hours, link, review,
  rules, categories, tags, statement, measures, search, reminders, taxyear,
  undo/changes, admin/*.
- Writes go through `upsert`: UPDATE when the key exists, else INSERT; never
  REPLACE. Each write logs its reverse in `change_log`; delete snapshots rows
  that point at it so undo restores them too.
- Backups: one copy a day plus one before anything risky, newest 30 kept, to
  `backups/` beside the database or `--backup-dir` (use the computer's disk when
  the database is on a stick). Integrity check on every start; a damaged file
  stops the app. An old app refuses a newer schema.

---

## 3. What to build: one environment, three apps

**Decided by the user:**
1. Three apps that complement each other but stand alone: **Money** (pay,
   hours, spending — what exists), **Log** (a diary of his day and work day),
   **Learn** (structured learning, and something to do instead of scrolling).
2. **Separate databases.** No app reads another's database. Remove one and
   the others carry on.
3. **One environment**: one launcher, one server, one look, one set of tools.
4. **One browser window with three tabs** (Money, Log, Learn).
5. **One password for everything**, default **`pass`**, changeable in Admin.
   The whole app is locked until signed in (today only admin is locked).
6. **Bills stay in Money.**
7. **Learn starts with**: A-level Maths, PLCs, A-level Physics (emphasis on
   ultrasonic testing and electricity), Electronics, Drives and Motion.
8. **Learn must be very interactive.**
9. **Agreed extras**: calendar feed, phone capture, voice notes, safe to
   spend, receipts, maths notation.
10. He may host it on a **Raspberry Pi** reached over **Tailscale** (§9.3).

---

## 4. The shared environment

### 4.1 Layout on disk

```
suite/
  Finances.pyw  finances.py            launcher and CLI (rename if you like; keep one entry point)
  core/                                shared server code: server.py, db.py, api.py (generic parts)
  web/core/  web/ui/                   shared browser code (everything in §2.2)
  web/home/                            the Home page (§8)
  apps/money/  migrations/ views.sql app.py(extra endpoints) web/views/*.js
  apps/log/    migrations/ views.sql app.py web/views/*.js
  apps/learn/  migrations/ views.sql app.py web/views/*.js content/<subject>/*.json
  data/        money.db log.db learn.db suite.db backups/
  tests/
```

An app is a folder. The server discovers `apps/*`. Each app has its own
migrations, views, backups, undo history and search. Adding a fourth app later
is another folder.

### 4.2 URLs and tabs

- `/money/#/…`, `/log/#/…`, `/learn/#/…`, Home at `/`. API under
  `/money/api/…` etc.; suite endpoints under `/api/…` (login, theme, home).
- Same origin for all, so one sign-in cookie covers every tab.
- The menu bar gets **Money · Log · Learn** at the left. Clicking one focuses
  that app's tab if open (`window.open(url, 'suite-money')` with a fixed window
  name reuses the tab), else opens it.
- The launcher opens one normal browser window (not app mode) with its own
  profile and the three tabs.

### 4.3 The suite store (`suite.db`)

Small, no personal data: the password hash, sessions secret, themes and the
theme in use, which database file each app opens (replaces
`last-database.txt`), the calendar-feed token, Home layout. Migrations of its
own.

### 4.4 Shared toolkit

Every app gets, unchanged from §2.2: panels and layout editing, grids, charts,
formulas, tablefx, themes, menus/right-click/keys, search box (searches this
app; "Search everywhere" in the menu asks every app and groups by app), undo
and Change history, backups, Admin (per-app sections plus suite sections for
password and themes), database switching per app, rewording.

Keep the toolkit app-agnostic: nothing in `web/core` or `web/ui` may import
from an app.

---

## 5. Money

Everything in §2, now living in `apps/money`, database `money.db` (the
existing `finances.db`, renamed on first run of the suite, with a backup).

**Moves out to Log**: the work log (`shift_log`) and the Work log page (§6.5).
The timesheet keeps a small "Log" link per day that opens that day in Log
(`/log/#/day?d=2026-09-03`, by date only).

**Reminders**: bills and money reminders (P60 check, tax code check) stay here.

**New:**
- **Safe to spend until payday.** Days to the next payday; money available =
  balance (the latest statement closing balance of the chosen current account,
  or a "balance today" box he can type for accuracy) − bills due before
  payday (from reminders with amounts) − a planned savings amount (setting).
  Shows the total and a per-day figure. A tile on Money's overview and a Home
  card. Explicit inputs only; say which balance date it used.
- **Receipts.** A photo (or PDF image) attached to a transaction: table
  `receipt(id, txn_id → txn ON DELETE CASCADE, image, thumb, note, created)`,
  same shrink-in-browser and JPEG CHECK as the work log. A paperclip on
  transaction rows; right-click → "Attach a receipt…"; searchable by note;
  optional receipts without a transaction yet (match later by amount/date).
- **Calendar feed contribution** (§8.2): bills, payday, days off, bank holidays.

---

## 6. Log

A diary of his day and his work day. Database `log.db`.

### 6.1 Entries

`entry(id, day, at (HH:MM, optional), kind ('day'|'work'), text, tags,
created, updated)` plus `attachment(id, entry_id → entry CASCADE, type
('photo'|'voice'), data (data URL), thumb, duration_s, created)`.

- **Day page** (`#/day?d=`): the day's diary (free text, one entry of kind
  `day`), then work entries in time order, each with photos and voice notes.
  ◀ ▶ between days; Today.
- **Quick add** always visible: text, time (defaults to now), kind, photo,
  voice. Paste a screenshot. Drag a photo in.
- **Timeline**: days newest first, with the first lines and thumbnails.
  **Calendar**: month grid with dots on logged days (reuse `calendar.js`).
- **Tags**: typed words (`#site`, `#TS247`); a tag list; click to filter.
- **Search** across text and tags.
- **Print a day or a range** (print CSS) for HR or a customer.

### 6.2 Voice notes

`MediaRecorder` (audio/webm; opus), record/stop button, shows duration,
stored as a data URL attachment, played with `<audio>`. Limit 10 minutes a
note. Needs a secure context: works on `localhost` and over HTTPS
(Tailscale Serve, §9.3); over plain `http://<ip>` the browser refuses the
microphone, so hide the button and say why. No transcription (no network).

### 6.3 Photos

As today's work log: shrunk to 1600 px JPEG with a 240 px thumbnail in the
browser; `<input type=file accept=image/* capture=environment>` so a phone
opens the camera.

### 6.4 Phone capture

- **Android**: the Log app's manifest declares a Web Share Target
  (`share_target`, POST multipart to `/log/share`), so "Share → Log" from the
  gallery or any app creates an entry for today with the photo or text.
  Requires the app installed as a PWA over HTTPS.
- **iPhone**: Safari has no share target. Offer the in-app camera and quick
  add, and document an iOS Shortcut that posts to `/log/api/quick` with the
  session cookie or a per-device token.

### 6.5 Moving the work log from Money

On first run: back up both databases, copy every `shift_log` row into Log as a
`work` entry on the shift's date (`at` from the row, the shift's times as a
first line, photos as attachments), check the counts match, then (and only
then) drop `shift_log` from Money in a Money migration. Show what moved.

### 6.6 Reminders in Log

None. He said Log is "just for logging my day". Reminders and bills live in
Money (see §14 if that changes).

---

## 7. Learn

Structured learning, and a better thing to do than scroll. **It must be very
interactive**: most cards ask him to do something, not just read. Database
`learn.db` for progress; content in files (§7.8).

### 7.1 Two ways in

1. **Feed** (instead of scrolling). Full-screen vertical cards with scroll
   snap; swipe or ↓/space for the next. Each card takes under a minute. The
   feed mixes due reviews, the next new cards from the courses he is on, and
   generated practice questions, weighted by subjects he picks. Gestures:
   swipe left "too easy" (push it further out), right "save for later".
   Keyboard on desktop: 1–4 answer, Enter check, ↓ next.
2. **Courses** (structured). Subject → unit → lesson; a lesson is an ordered
   run of cards. "Continue where you left off". Prerequisites show but do not
   lock. Mastery per topic.

Plus **Review** (only due cards) and **Practice** (endless generated questions
on chosen topics).

### 7.2 A healthier feed

It replaces scrolling, so it should end well rather than never end: a daily
goal ring (cards or minutes, his choice), a short summary after every 20
cards ("20 done · 17 right · 3 back tomorrow"), and the offer to stop or carry
on. No fake urgency, no streak shame, no notifications nagging. Streaks and
totals are shown plainly.

### 7.3 Card types

| Type | What he does |
|---|---|
| concept | reads a short idea (≤ 120 words) with a diagram or formula; one tap to go on |
| widget | plays with a simulation, then answers a question about what he saw |
| mcq | picks one of 3–5 answers; instant feedback with the reason |
| numeric | types a number (units shown); checked with a tolerance; values randomised each time |
| steps | a worked example revealed one step at a time; he predicts each step first |
| order | puts steps or rungs in the right order (drag) |
| match | pairs terms with meanings or symbols with units |
| flash | front and back, rated Again / Hard / Good / Easy |
| code | reads or completes a short Structured Text or ladder snippet run in the PLC sim |

Wrong answers become flash cards in his review queue automatically (with the
reason). He can write his own cards on any topic.

### 7.4 Spaced repetition

Per card: `due, interval_days, ease, reps, lapses, last_rating`. SM-2
style: Again → back in minutes and ease −0.2; Hard → ×1.2; Good → ×ease;
Easy → ×ease×1.3; ease floor 1.3. Answered cards (mcq, numeric…) count as
Good when right first time, Again when wrong. Mastery of a topic = share of
its cards at an interval of 21 days or more. Keep it this simple
(`ponytail:` note the upgrade path to FSRS).

### 7.5 Question engine

Numeric and generated questions are templates with variables and an answer
formula, evaluated by the existing formula engine (`web/core/formula.js`):

```json
{ "type": "numeric",
  "q": "Steel, longitudinal velocity {v} m/s. A back-wall echo at {t} µs. Thickness?",
  "vars": { "v": [5850, 5950, 10], "t": [5, 20, 0.5] },
  "answer": "v * t / 1e6 / 2 * 1000", "unit": "mm", "tolerance": 0.02,
  "why": "Pulse-echo: the sound goes there and back, so d = v·t/2." }
```

`vars` are [min, max, step]. Tolerance is relative. Show the worked answer
with his numbers after he answers.

### 7.6 Maths notation

A small TeX-subset → MathML converter in `web/ui/math.js` (fractions, powers,
subscripts, roots, Greek letters, ∫ ∑ lim, vectors, matrices 2×2/3×3,
units). Chromium, Firefox and Safari render MathML natively, so no library.
Used in card text (`$…$` inline, `$$…$$` display), notes, and Log entries if
he types it. Include a check that converts a list of expressions.

### 7.7 Interactive widgets

Own SVG/canvas code, no libraries, each a module in
`apps/learn/web/widgets/` taking `params` and reporting what he set so a
question can ask about it. Build the ones marked ★ first.

**Maths**
- ★ Function grapher with sliders for parameters (y = a·f(bx+c)+d; polynomials, trig, exp, ln)
- ★ Tangent and gradient explorer (drag a point; secant → tangent)
- Area under a curve (Riemann rectangles → integral)
- Unit circle and trig graphs linked
- 2D vectors (add, resolve, dot product)
- Sequences and series (partial sums plotted)
- Binomial/normal distribution explorer
- Projectiles (mechanics)

**Physics (ultrasonic testing and electricity first)**
- ★ Pulse-echo A-scan: material velocity, thickness, flaw depth and size, gain
  (dB), attenuation, gate → time of flight and amplitude. Front wall, flaw and
  back-wall echoes.
- ★ Acoustic impedance: two materials, reflection and transmission
  coefficients, the interface drawn (water/steel, perspex/steel, couplant).
- Snell's law with mode conversion: incident angle, first and second critical
  angles (angle probes).
- Near field length and beam spread for a probe (diameter, frequency, velocity).
- ★ DC circuits: series/parallel resistors, potential divider, meters
- EMF and internal resistance; resistivity of a wire
- ★ Capacitor charge/discharge (RC time constant)
- AC: peak, RMS, frequency, phase; a simple oscilloscope view
- Waves: superposition, standing waves, frequency/wavelength/speed
- Magnetic fields and induction (Faraday/Lenz) — the bridge to motors

**Electronics**
- ★ Ohm's and Kirchhoff's laws on small editable circuits
- RC/RL filters with a Bode plot
- Transistor (BJT/MOSFET) as a switch driving a relay or lamp
- Op-amp: inverting, non-inverting, comparator, gain
- Logic gates and truth tables; build a small combinational circuit
- Sensors: 4–20 mA scaling, PT100, thermocouple, encoder pulses
- PWM duty cycle and average voltage; ADC resolution

**PLCs**
- ★ Mini PLC: a scan cycle you can step; inputs as switches, outputs as lamps;
  ladder rungs (NO/NC contacts, coils, set/reset, TON/TOF, CTU/CTD, rising
  edge) and a Structured Text subset (assignments, IF/ELSIF/ELSE, CASE,
  timers, counters). Shows the order of the scan and why a coil flickers.
- State machine designer (states, transitions, CASE output)
- Analogue scaling (raw counts → engineering units)
- Seal-in circuits, interlocks, start/stop/E-stop logic
- Comms at a glance (Profinet, EtherNet/IP, Modbus TCP/RTU): addressing and
  byte order exercises

**Drives and motion**
- ★ PID loop on a first-order-plus-dead-time plant: Kp, Ki, Kd sliders, step
  response, overshoot and settling time measured
- ★ Motion profile: trapezoidal vs S-curve (jerk, accel, velocity, position)
- Induction motor torque-speed curve; V/f control; slip
- Encoder resolution, counts per unit, quadrature (×4)
- Gear ratio and inertia matching
- DC drive basics (armature, field, current loop)
- Cascaded loops (current → speed → position) and why the inner loop is fastest

### 7.8 Content

Content is data, written in files and loaded into `learn.db` on start by
content id (progress is kept apart, so content updates never lose progress):

```
apps/learn/content/<subject>/<unit>/<lesson>.json
{ "id": "physics.ut.pulse-echo", "title": "Pulse-echo testing",
  "prereq": ["physics.waves.basics"], "tags": ["ut"],
  "cards": [ { "id": "…", "type": "concept", "body": "… $d = \\tfrac{vt}{2}$ …", "widget": null }, … ] }
```

Card ids are stable forever. A Learn admin page lets him add and edit his own
cards and lessons (saved to `learn.db`, not the files) and import a CSV of
flash cards (front,back,topic).

**Starting syllabus.** Build the outline for all of it as units and lessons;
fill the ★ lessons with 15–30 cards each first, the rest after.

- **A-level Maths** (Edexcel-style). Pure: ★algebra and functions, ★coordinate
  geometry, sequences and series, binomial expansion, ★trigonometry,
  exponentials and logarithms, ★differentiation, ★integration, numerical
  methods, vectors, proof. Statistics: sampling, data, probability, binomial and
  normal distributions, hypothesis testing. Mechanics: kinematics (suvat),
  forces and Newton's laws, moments, projectiles.
- **A-level Physics** (emphasis ultrasonic testing and electricity).
  Measurements and uncertainties; ★waves (progressive, superposition,
  refraction); ★**ultrasound and NDT**: generation (piezoelectric), pulse-echo,
  time of flight, acoustic impedance and reflection, attenuation and dB,
  couplant, probes (normal, angle, dual), near field, A-scan/B-scan/C-scan,
  calibration blocks, flaw sizing basics; ★**electricity**: charge, current,
  potential difference, resistance and resistivity, series/parallel, potential
  dividers, EMF and internal resistance, ★capacitors, AC and RMS, the
  oscilloscope; fields (electric, magnetic, ★electromagnetic induction);
  mechanics essentials; thermal and nuclear in outline.
- **Electronics**: ★Ohm's and Kirchhoff's laws, diodes and rectifiers,
  ★transistors as switches, op-amps, filters, power supplies and regulation,
  digital logic, ★sensors and signals (4–20 mA, 0–10 V, PT100, thermocouples,
  encoders), ADC/DAC, PWM, EMC and grounding basics.
- **PLCs** (IEC 61131-3): ★the scan cycle, ★data types and addressing,
  ★ladder basics (contacts, coils, seal-in), ★timers and counters, edge
  detection, ★Structured Text/SCL, state machines, FBD and SFC, analogue
  scaling, PID blocks, fault handling and diagnostics, comms (Profinet,
  EtherNet/IP, Modbus), HMI tags, functional safety basics (ISO 13849,
  categories and PL, E-stops, safety relays), good structure and naming.
  Examples on Siemens (TIA Portal) and Allen-Bradley (CCW/Micro800).
- **Drives and Motion**: ★induction motors and slip, ★V/f and vector control,
  DC drives, servo motors and amplifiers, ★encoders and resolvers, ★PID and
  cascaded loops, tuning (current, speed, position), feedforward, ★motion
  profiles (trapezoidal, S-curve), gearing and cams, homing and limits,
  inertia matching, braking and regeneration, parameter sets and fault finding.

Write content accurately and check every numeric answer by running it
(§11). Where a figure is standard-dependent (e.g. an exam board or a probe
spec), say so on the card.

### 7.9 Progress

Home card: cards due, today's count, goal ring. Learn stats page: time and
cards per day (heatmap calendar), accuracy by subject, mastery per topic (bars),
hardest cards. A study timer (focus minutes) logs time per subject.

---

## 8. Home, calendar feed and phone

### 8.1 Home (`/`)

One card per installed app, from `GET /<app>/api/home` (small JSON; the card
renders whatever it gets):
- Money: days to payday, safe to spend, bills in the next 7 days, hours this week.
- Log: today's entries count, last entry, quick add.
- Learn: cards due, goal ring, "Start the feed".

If an app is missing or errors, its card says so and the rest still work.

### 8.2 Calendar feed

`GET /cal/<token>.ics` (token from `suite.db`, shown in Admin with Copy and
Reset). No sign-in (calendar apps cannot sign in); the token is the key.
Each app contributes events through `GET /<app>/api/calendar?from&to`:
Money (bills with amounts, payday, days off, bank holidays), Learn (optional:
a daily review reminder). Standard `VCALENDAR`/`VEVENT` text, UTC or
floating dates, stable UIDs. Subscribe from Outlook or the phone's calendar.
Note: a calendar service that fetches from the cloud (Google Calendar) cannot
reach a Tailscale address; the phone's own calendar and Outlook desktop can.
Also offer "Download .ics" for a one-off import.

### 8.3 Phone

The PC (or Pi) serves; the phone is a window onto it. Over Tailscale with
HTTPS (§9.3) the phone can install each app as a PWA (Home screen icon),
use the camera, voice notes and the share target. Layouts must work at
390 px wide (today they do, with the sidebar as a drawer).

---

## 9. Running it

### 9.1 Windows PC

`python finances.py install` makes Start menu and desktop shortcuts to
`Finances.pyw`. It starts the server on port 8765 and opens **one normal
browser window** (Edge, else Chrome; its own profile under
`%LOCALAPPDATA%\Finances\window`) with the three tabs, and stops the server
when that window's browser has gone (profile lock check). Today it opens a
single Edge app-mode window on Money; change it to the three tabs. Opening it again
while running opens the window again. Errors go to a message box and a log
file (pythonw has no console).

### 9.2 USB stick

`finances.bat` / `finances.command` with a portable Python in `./python`.
Databases on the stick, backups to the computer (`FINANCES_BACKUPS`).

### 9.3 Raspberry Pi over Tailscale (he may do this)

Yes, it works as it is: Python 3.11 and SQLite 3.40 come with Raspberry Pi OS
(Bookworm, 64-bit), and nothing needs compiling or downloading. Set up:

1. Pi 4 or 5 with Raspberry Pi OS Lite 64-bit. Put the data folder on a
   **USB SSD**, not the SD card (SD cards corrupt on power cuts and wear out).
2. Copy the suite folder; run it as a systemd service bound to `127.0.0.1`
   (a unit file and `finances.py install --service` should be provided):
   `python3 finances.py serve --host 127.0.0.1 --port 8765`.
3. Install Tailscale and publish it inside the tailnet with HTTPS:
   `tailscale serve --bg --https=443 http://127.0.0.1:8765`.
   Open `https://<pi-name>.<tailnet>.ts.net` from the PC and phone; pass that
   name with `--allow-host`. No router port forwarding is needed or wanted.
4. HTTPS matters: the phone's microphone (voice notes), share target and PWA
   install all need it.
5. Back up off the Pi every night (to the PC over Tailscale, or a synced
   folder): the Admin backups plus a copy of the `data/` folder.
6. The PC launcher gets a "remote" mode: `FINANCES_URL=https://pi…` opens the
   window with the three tabs and does not start a server.

Performance is fine for one person; the heaviest thing is photos in the
database (keep the 1600 px limit).

---

## 10. Security

- **Everything is locked** until signed in: one password for the whole suite,
  default **`pass`**, stored as PBKDF2-SHA256 (200k iterations, per-password
  salt) in `suite.db`. Sign-in page at `/login`; a session cookie (`HttpOnly`,
  `SameSite=Strict`, `Secure` when served over HTTPS) lasting 30 days on that
  device ("Lock" signs out). Rate-limit wrong passwords (8 per 5 minutes).
- While the password is still `pass`: a red banner on every page, and the
  server refuses to listen beyond `localhost` (today's rule, keep it).
- Admin actions need the same sign-in; changing the password asks for the
  current one.
- Keep the doors: the `Host` header must be a known name or an IP address
  (DNS rebinding); `Origin` checked on writes; every write carries the
  `X-Finances: 1` header; request bodies capped. The old `?t=` token for
  non-local binding can go once sign-in covers everything.
- Only the calendar feed is reachable without signing in, by its secret token.
- Images and audio are stored as data URLs with CHECK constraints on the MIME
  prefix (`data:image/jpeg;base64,`, `data:audio/webm;base64,`); never serve
  user content as HTML.

---

## 11. Checks and acceptance

- **One runnable check per non-trivial piece of logic**, no frameworks:
  `python3 tests/test_<app>.py` (asserts, a temp database, exits non-zero on
  failure) and `node tests/<thing>.check.mjs` for browser logic that does not
  need a page (formula engine, date parsing, palette, TeX→MathML, SRS
  scheduling, question templates). Today: `tests/test_finances.py` and
  `tests/formula.check.mjs`; both must keep passing.
- **Content check**: every numeric card's answer formula evaluates for random
  variable values; every card id is unique; every prerequisite exists; every
  widget named exists.
- **Browser flows** with Playwright against a demo database (Chromium is
  available on the build machine; do not download browsers): each app's pages
  at 1500 px and 390 px wide with no console errors and no horizontal
  overflow; the main flows (add a shift, save a payslip, import, a log entry
  with a photo and a voice note, a feed session, a review) click through.
- **Upgrade check**: an existing `finances.db` from v1.6 opens in the suite,
  is backed up, becomes `money.db`, and its work log arrives in Log with
  matching counts.
- Demo data: `demo.py` extended to fill all three apps.

---

## 12. Order of work

Each step ends with all checks passing and a zip.

1. **Split into the suite.** Move shared code to `core/` and `web/core`,
   Money to `apps/money`, add `suite.db`, the sign-in (password `pass`), Home
   with Money's card, the app switcher, the three-tab launcher. Money behaves
   exactly as v1.6.
2. **Log.** Entries, day page, timeline, calendar, tags, photos, voice notes,
   search, print; move the work log across; the Money timesheet links by date.
3. **Learn, part 1.** Feed, courses, card types, SRS, question engine,
   maths notation, progress; the ★ widgets; the outline for all five subjects
   with the ★ lessons filled.
4. **Money extras.** Safe to spend, receipts.
5. **Calendar feed, phone capture, Pi service** (unit file, remote launcher
   mode, the HTTPS notes).
6. **Learn, part 2.** The remaining widgets and lessons.

---

## 13. Lessons already learned (bugs not to repeat)

- Never `INSERT OR REPLACE`: it deletes first and cascades. Update when the key
  exists, else insert. SQLite checks `NOT NULL` before `ON CONFLICT`.
- A cleared box is NULL, except in a `NOT NULL` column, where it is `''`
  (e.g. setting "the first pension account").
- Query-string values are text; a view's computed column has no type. Match
  with `IN (?, ?)` passing the text and the number.
- Commas are thousands (`24,000`), both in the browser (`toNumber`) and the
  server (`_maybe_float`). `parseFloat('24,000')` is 24.
- Class-name collisions: the toast used `.flash`; a panel highlight named
  `flash` took its styles and was deleted by the next toast. Namespace classes.
- `html, body { height: 100% }` stops a sticky header after one screen; use
  `min-height` on body.
- Refreshing a panel must keep its old content and height until the new
  content goes in, or the page gets shorter and the browser scrolls up.
- Resizing must compute from the drag start (`h0 + dy`), not the current size.
- `el(tag, {value})` sets the property, not the attribute: select with
  `:has()` or data attributes, not `[value=…]`.
- Passing `null` to `Element.append` prints "null"; the panel body filters it.
- Local storage was being cleared in the app window; anything that must
  persist lives in the database.
- The JSON encoder turns bytes into garbage: store images/audio as data-URL
  text, never BLOBs through the generic API.
- Migrations: drop views first, pause foreign keys, run in one transaction,
  run `foreign_key_check` after, record the version.
- On Windows `os.kill(pid, 0)` terminates the process; never call it there.
  `pythonw` has no stdout: log to a file.
- Edge `--app` windows pin as plain Edge; the fix is setting the window's
  AppUserModel ID and relaunch command (`Finances.pyw`, `pin_as_us`). With a
  normal three-tab window this no longer applies.
- The browser shows date inputs in its own locale; store ISO dates.
- "Don't be too smart": detected things are suggestions with a button,
  balances are typed, transfers are linked by hand.

---

## 14. Open questions

Defaults in bold; ask him if it matters.

1. Log holds **no reminders** (he said Log is just for logging his day).
   Non-money reminders such as the MOT stay in Money's Reminders page. If he
   later wants them in Log, move reminders without a payee, but keep money ones.
2. The three tabs: **Money, Log, Learn**, with Home reachable from the menu
   bar (not a fourth tab).
3. Learn feed weighting: **equal across the subjects he has switched on**;
   he can change weights.
4. Daily goal: **20 cards**, changeable.
5. iPhone or Android? Share target works on Android only; iPhone gets the
   in-app camera and a Shortcut.
