# Changes

## 4.0 — in progress (not released)

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

## 3.0 — in progress (not released)

Opens a 2.2 database and moves it on (Money migrations 002 and 003, Learn 002). All
tests pass; the new screens have not had a browser check yet.

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

Still to do (see CONTENT-BRIEF.md and LEARN-SPEC.md):
- Lessons: PLC data types, ladder, timers and counters, edges (links in CONTENT-BRIEF.md);
  the rest of Drives (tuning, feedforward, gearing, homing, inertia, braking, parameters).
- Calibration banks (calibrate.json) for all five subjects: 3+ questions per outline lesson.
- Pulse-echo: "Explain it another way" and hints.
- Browser check at desktop, half-screen and phone widths; README; version 3.0.0.

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
