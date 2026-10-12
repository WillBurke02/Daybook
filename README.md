# Daybook

Money, Log and Learn: one engine, one password, a database each, and a front
door per app with its own window and icon. Python standard library and SQLite
only, no build step, nothing online. Best run on a Raspberry Pi and opened from
every device (see *On the Pi*).

- **Hours and pay** (`/hours/`): hours, overtime, Send to HR, payslips, annual leave.
- **Spending** (`/spending/`): spending, accounts, bills, safe to spend, savings, pension, receipts.
  Both are Money: one database, two doors (`/money/` shows the lot).
- **Log** (`/log/`): a diary of the day and the work day, with photos and voice notes.
- **Learn** (`/learn/`): courses, a skill tree, and a feed of short cards to use instead of scrolling.

**Home** (`/`) has a card for each: payday and safe to spend, today's log, the
day's cards and what is due; on a new install, a **Set up Daybook** card with the
five things to do first, each a button. **Alt+1** is Home and **Alt+2** onwards
the apps in the order of the bar.

## Run it

Once, on your own computer:

```sh
python daybook.py install
```

That puts **Daybook** in the Start menu and on the desktop (macOS:
`~/Applications`; Linux: the app menu). Opening it starts the server and a
window of its own: Edge (else Chrome) in app mode, so no tabs and no address
bar, with Daybook's icon on the taskbar (pin it from there). Money, Log and
Learn are along the top bar and switch inside that window; ☰ holds the menu.
Closing the window stops the server.

Without installing, double-click `Daybook.pyw`. From a USB stick, use
`daybook.bat` or `daybook.command`, which also find a portable Python in a
`python` folder beside them. The plain server: `python3 daybook.py serve --open`.

Sign in with **pass**, then change it (Admin → Password). Until you do, a red
line says so, and Daybook will not answer any device but this one.

Python 3.9 or newer. Every database is checked on each start, migrated forward
and copied to `backups/` once a day (30 kept). A database over 200 MB, which
photos and voice notes can make of Log, is copied once a week instead (8 kept).

```
data/suite.db    the password, themes, keys, which database each app uses
data/money.db    Money
data/log.db      Log
data/learn.db    Learn: your progress and your own cards (the courses are files)
```

`--data` (or `DAYBOOK_DATA`) points somewhere else; `--backup-dir` (or
`DAYBOOK_BACKUPS`) sends the copies to another disk.

Sample data: `python3 demo.py demo-data`, then `python3 daybook.py serve --data demo-data`.

Checks: `python3 tests/test_money.py`, `tests/test_log.py`, `tests/test_learn.py`,
`tests/test_suite.py`, `tests/test_skilltree.py`, `tests/test_sync.py`, `tests/test_update.py`, `tests/test_packs.py`, and `node tests/<name>.check.mjs` for calc, formula, math,
learn, content, tree and web.

## Money

Pick a period (week, month, two months, quarter, tax year, year, all) and step
with ◀ ▶; every page follows it. Every table is edited in place: click a cell,
type, leave it. **Undo** reverses the last change; Change history any earlier one.

- **Hours.** Type shifts into the timesheet (`0730` is `07:30`); a split day is
  two rows. The new row shows your usual start and finish from the last 30 days
  in grey; leave them and they are what is added. Overtime per day by rule
  (Settings → Overtime rules). **Send to HR**: the month as a table of date,
  start, finish and overtime, each week in its own colour, for the body of an
  email: **Copy as table** (pastes into Outlook or Gmail with its colours, or
  Excel as columns) or **Open as Outlook draft**; its month is the last full one
  unless you pick another.
  Imports Clockify and spreadsheets. Each day links to that day in Log.
- **Pay.** Payslips as lines in groups, each line counted as Basic, Overtime,
  Tax, NI, Pension… A new payslip is marked **New** until saved, starts from the
  last one's lines with nothing to delete, and shows basic pay and the overtime
  rates worked out from your salary in grey (left, they are saved). Enter goes
  to the next box; the pay date and the month worked stay a month apart. A new
  payslip never replaces a saved one. Expected pay from the hours beside it.
  **P60s**: one row a tax year, checked against that year's payslips.
- **Annual leave.** Type days off as you would write them (`8-12 Sep`, `25/04`),
  as annual leave, time off in lieu or other. Step through the years in the
  page header; bank holidays for England and Wales are worked out for any year
  (2000 on, with the one-off days), and can be changed.
- **Accounts and spending.** Import statements: CSV from any bank (Barclays and
  Nationwide read as they come), Santander's .txt, QIF. The balances come from
  the file's balance column when it has one (or type them); rows already in the
  account are skipped, so overlapping exports add nothing twice.
  Payee rules sort spending into categories. Transfers are linked by hand. A
  sort code is written 20-45-77 however typed, and names its bank (from the
  first digits; type over the provider if it is wrong).
- **Safe to spend** (Overview). Type the balance of the account you spend from
  and its date: less the bills due before payday and what you set aside, it
  shows what is left, and per day.
- **Receipts.** A photo or PDF on any payment (the paperclip, or right-click).
  A receipt added with no payment waits, and is offered to the payment that
  matches its date and amount when that comes in on a statement.
- **Reminders.** Bills and anything that comes round. A bill tied to a payee
  ticks itself off when the payment goes out.
- **Pension.** Payslip lines and payments in, valuations, the annual allowance.
- **Savings, investments and pensions** take a value typed in or read off a
  statement PDF. **Import a Trading 212 CSV** (History → Export in Trading 212)
  records its deposits and withdrawals as money paid in and taken out, each
  once, however often the file is imported; dividends and interest are shown,
  not recorded (the valuations already count them).

## Log

The day page has the diary (one a day) and the work entries in time order.
Type in the box at the top of any page; `#words` are tags. Photos are shrunk to
1600 px; paste a screenshot with Ctrl+V or drop a file. Voice notes record in
the browser. The day also shows that day's shifts from Money. Timeline, a
calendar with a dot for each entry, tags, search and print (a day or a range).
`[` and `]` step through days.

## Learn

- **Feed.** Full-screen cards, one at a time: swipe up (or ↓, Space) for the
  next, left (←) for "too easy", right (→) to save it for later. It brings
  what is due for review first, then the next new cards in the courses you have
  on, then practice with new numbers, taking turns between subjects by weight.
  After every 20 cards it sums up and offers to stop; the ring is the daily goal
  (20 cards, or minutes, in Today → Feed settings).
- **Skill tree.** Each subject as a map: columns are the stages (easy to hard,
  left to right), rows are units, lines are prerequisites. Every lesson shows
  where it stands (★ solid, ✓ learned, ◐ in progress, ○ ready, ◌ needs
  something first, · not written yet). Pick one to see what it needs and what it
  opens. **Make this my goal** and the tree becomes a route to it: the steps
  numbered, the rest dimmed, the next step on Today. Nothing locks.
  No points, ranks or badges: Today counts what matters (minutes, days and
  lessons learned this week). A lesson is learned when its check questions are
  right, wherever you answer them (the feed and Review count too); it then says
  what it opened.
  The plan and what it leaves out: PLAN-SKILLTREE.md. Ideas for more interactive
  lessons: LESSON-INTERACTIVITY.md.
- **Courses.** Subject, unit, lesson. A lesson is a run of cards; Continue
  takes you back to where you were. Prerequisites show but never lock.
- **Review** is only what is due. **Practice** is endless numeric questions
  with new numbers, on the lessons you pick.
- **Stats**: a heatmap of the days, accuracy by subject, mastery by topic
  (cards next due in 21 days or more), the hardest cards, timed study.
- **Study timer** on Today logs focus minutes against a subject.
- **My cards**: write your own (a flash card, or any type as JSON), file them in
  your own lessons or any course lesson, and import a CSV of `front,back,topic`.
  A wrong answer becomes a flash card of its own, due at once.
- **Whiteboard and calculator** beside any card: **Alt+W** and **Alt+C** (they
  work while typing an answer; W and C too when not), or the links on the card.
  On a wide screen they dock in a column at the right and the page makes room,
  so the card is never covered; drag one by its title bar and it floats where
  you leave it, until **Dock**. Ctrl+Z after drawing undoes the drawing. The board
  takes a pen (with pressure), a finger or a mouse; pen, eraser, four colours,
  four pen widths, plain, squared or graph paper (enlarging the window shows
  more of it, it never zooms), undo and redo. One board a card, kept: when the
  card comes back it offers your working from last time. The calculator types or
  takes its keys (Shift for sin⁻¹ and the like): **Calc** for sums, with SI
  prefixes (`4.7k`, `220µ`), degrees or radians, `ans` and engineering notation,
  and **Use this answer** into the card's box; **Graph** for up to three
  functions of x (drag to move, scroll to zoom, point to read values, Fit y);
  **Solve** for an equation in x (`x^2 - 5 = 3x`), every root in a range, then
  Graph it. `2x`, `3sin(30)` and `(1+2)(3)` read as written; `-2^2` is −4.

- **Courses from elsewhere** (My cards): an Anki deck (`.apkg`), a Moodle XML or
  GIFT quiz, or a Daybook course pack (`.zip`) becomes a subject of its own.
  Multiple choice, numbers, matching, true or false, cloze and flash cards come
  in, pictures too; anything else is counted and left out. Imports live in
  `data/courses/`, so an update never touches them; importing the same file again
  updates it and keeps your progress. Any course downloads as a pack from Courses.
- **More ways in**: widget cards that ask you to predict before you can touch the
  controls; "explain the step" cards (your words, then the model answer and its
  key points); "spot the mistake" cards; bench tasks at the end of a lesson,
  with a checklist and a line for today's Log; and **Listen**, which reads a
  lesson's summary aloud.

Keys: 1–4 answer or rate, Enter check, ↓ next, Alt+W whiteboard, Alt+C calculator.
Answers take SI prefixes: 4.7k, 470µ, 5m on an amps card.

### Writing content

A course is files under `apps/learn/content/<subject>/`: `subject.json` is the
outline (units and lessons), and each written lesson is
`<unit>/<lesson>.json`. They load into `learn.db` on every start by id, so
editing a file never loses progress; **card ids are forever**.

```json
{ "id": "physics.ut.pulse-echo", "title": "Pulse-echo and time of flight", "prereq": ["physics.waves.progressive"],
  "cards": [
    { "id": "idea", "type": "concept", "body": "… $d = \\frac{vt}{2}$ …", "widget": { "name": "ascan", "params": {} } },
    { "id": "thickness", "type": "numeric", "q": "Steel at {v} m/s, echo at {t} µs. Thickness?",
      "vars": { "v": [5850, 5950, 10], "t": [5, 20, 0.5] }, "answer": "v * t / 2000", "unit": "mm",
      "tolerance": 0.02, "work": "$d = {v} \\times {t} \\div 2000 = {answer}$ mm", "why": "There and back." } ] }
```

Types: `concept`, `widget` (a simulation, then an `ask`, optionally a
`predict` first), `mcq`, `numeric`, `steps`, `order`, `match`, `flash`, `code`
(Structured Text with `___` blanks and tests), `explain` and `spot`. The full
format, with the lesson stages, is in `CONTENT-BRIEF.md`. Text takes `**bold**`, `*italic*`, `` `code` ``, `- ` lists and
maths as `$…$` or `$$…$$`. Formula names ignore case, so `T` and `t` are the
same variable. `node tests/content.check.mjs` runs every numeric answer with
random numbers and every code card's solution against its tests.

Widgets (in `apps/learn/web/widgets/`): `ascan` (pulse-echo A-scan with gain
and a gate), `impedance`, `pid`, `grapher`, `plc` (the scan cycle, in
Structured Text), `ladder` (rungs with power flow), `circuit`, `motor`,
`encoder`, `profile`, `timer`, `fraction`.

Sixteen subjects are outlined (236 lessons). Written so far: Maths foundations,
Ohm's and Kirchhoff's laws, pulse-echo and acoustic impedance, the PLC basics
(scan cycle, data types, ladder, timers and counters, edges), the drives
lessons (motors, V/f and vector, DC, servo, encoders, PID, motion profiles), and
the first curriculum batch: safe isolation, proximity sensors, IP addressing,
reading schematics, fault finding, fasteners. Every subject has a calibration
bank (`calibrate.json`, 643 questions, 3 or more per outline lesson) for Find
my level; bank questions place you and never count as a lesson's cards.

## Making it yours

**Customise** (top bar) works on the page you are on, and saves as you go:

- Drag a panel by its grip; set its width (¼ ⅓ ½ ⅔ Full) or drag its edge; hide
  it (the eye) or remove it. **Add a panel** lists every app panel not on the
  page, and makes your own chart, table, figures or note. Pick the data by
  name (Days worked, Payslips, Spending…) and a few rows of it show what each
  column holds; only the columns that fit each choice are offered. **Add
  columns from another source** joins a second one on a shared column (days
  worked and that day's spending, say): its matching rows are added up.
- The cog: title, header colour and body colour (text turns dark or light to
  suit), table look, font, size, height.
- The page's width: full, or narrow for reading. **Reset page** puts it back.
- In the sidebar: drag pages to reorder them, hide them (they stay in the Go
  menu), click a name to rename it, and add pages of your own.

**Arrange** on Home orders the app cards, makes one wide or hides it. Figures
and entries on Home and on Overview open what they come from.

Half a screen is fine: the layout goes by the width of the page, not the
screen. Small panels pair up and the rest go full width; the sidebar becomes a
drawer (☰ at the left of the bar) below 900 px, and a phone gets a tab bar.
☰ → Edit → **Reword the labels**: click any heading or button to change it.
Each app has its own colour; Admin → Themes sets them.

## Admin

Admin (☰, or the foot of the sidebar) works on the app you are in.

- **Databases**: open another file for this app (checked and shown first), or
  make an empty one or a copy.
- **Themes** (shared by all three apps), **Pages**, **Columns**, **Data**,
  **SQL** (reads on a read-only connection; anything else backs up first),
  **Backups** (restore any copy; the present is backed up first).
- **Password**: one for everything. Changing it signs every other device out.
- **Calendar feed and phone**: the keys below.

Formulas (added columns, rows and panels) have functions such as `SUM`, `IF`,
`ROUND`, `SQRT`, `LOG10`, `SIN`, dates and periods; the box shows what fits as
you type.

## More than one computer

Each computer runs its own Daybook and keeps working offline. **Sync** keeps them
the same through a folder they can all reach: OneDrive, Google Drive, Dropbox, a
NAS, a USB stick, or a private GitHub repository. No server is needed.

On the first computer, Admin → **Sync between computers**: pick the folder, leave
the code empty, **Start**. You are given a **sync code**: keep it in your password
manager. On each other computer, pick the same folder (wherever it is on that
computer), type the code, **Join**. From the command line:

```sh
python daybook.py sync --folder "C:\Users\you\OneDrive\Daybook sync"             # the first computer
python daybook.py sync --folder "D:\OneDrive\Daybook sync" --code ABCD-EFGH-…    # each other one
python daybook.py sync --github you/daybook-data --token …                       # or through GitHub
python daybook.py sync                                                           # a round now
```

- Each computer writes its changes to files of its own, never changed once
  written, so OneDrive never has two versions of a file to choose between. The
  databases themselves never go in the folder (a synced SQLite file corrupts).
- The files are encrypted with the sync code. Without it, the folder is noise.
- A round runs every minute, a few seconds after each change, and as Daybook
  closes. Offline, changes wait; they go when the folder is back.
- The newest change to each field wins. When both computers changed the same
  field, the value that lost is in **Change history**, and **Undo** brings it
  back. A diary started on both the same day keeps both texts.
- The courses are not synced (every copy of Daybook has them); your progress,
  your own cards, Money and Log are.
- A computer that joins keeps what it has: rows that are the same on both are
  matched, not doubled. Its settings give way to the ones already in use.
- **Restoring a backup** on a synced computer brings the file back, then the next
  round brings the changes made since back too. To take back a change, use
  Undo, which syncs like any other change.
- A copy made in Admin → Databases to try things on does not sync.
- Import a bank statement on one computer only: the same statement imported on
  two becomes two sets of transactions.
- For GitHub: a **private** repository and a fine-grained token with read and
  write access to its contents. The files go in `daybook-sync/`.

## Updating

The code lives on GitHub (`WillBurke02/Daybook`): change it there, from anywhere,
and each computer takes the newest with Admin → **Daybook version** → Update now,
or:

```sh
python daybook.py update             # the newest release from GitHub
python daybook.py update --check     # is there any?
python daybook.py update --rollback  # the code from before the last update
```

Then close Daybook and open it again. Your data is never touched: `core/`,
`apps/`, `web/` and `tests/` are replaced whole and the files beside
`daybook.py` overwritten; `data/`, `backups/` and a portable `python/` stay as
they are. Code older than your databases is refused. A copy that is a git
checkout is updated with `git pull` instead. It takes the newest **release** (a
tag such as v4.1, made on GitHub under Releases), so work in progress on `main`
never reaches the Pi; until the first release it takes `main`.
`DAYBOOK_UPDATE_BRANCH` follows a branch's newest commit instead,
`DAYBOOK_UPDATE_REPO` points it at another repository, `DAYBOOK_GITHUB_TOKEN`
for a private one.

## On the Pi: always there, from the PC, the laptop and the phone

Daybook runs on a Raspberry Pi all day; the PC, the site laptop and the phone are
windows onto it over **Tailscale** (free: a private network of your own devices,
with HTTPS). Nothing is open to the internet, and the PC no longer has to be on.

**Once, on the Pi** (Raspberry Pi OS has Python already):

```sh
curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up   # sign in; switch HTTPS on once in
                                                                         # the Tailscale admin console, under DNS
scp -r you@yourpc:Daybook ~/Daybook        # the whole folder from the PC: the code and data/ with it
cd ~/Daybook
python3 daybook.py password                # if it is still "pass" (as yourself, not sudo)
sudo python3 daybook.py install --service  # add --backup-dir /media/usb/daybook for copies on a USB drive
```

`install --service` finds the Pi's Tailscale name, writes and starts a systemd
service (Daybook from boot, restarted if it stops, listening on 127.0.0.1 only)
and points Tailscale's HTTPS at it. It prints the address:
`https://pi.tailXXXX.ts.net`. Stop using the copy on the PC once the Pi has it
(rename its `data` folder), so there is one Daybook.

**On the PC and the site laptop** (Tailscale installed and signed in):

```sh
python daybook.py install --url https://pi.tailXXXX.ts.net
```

Start menu shortcuts: **Daybook** (Home), **Daybook Log**, **Daybook Hours and pay**,
**Daybook Spending** and **Daybook Learn**, each its own window with its own taskbar
icon (pin the ones you use). **Ctrl+Alt+L** opens Log, ready to type in. Without
Python on a machine, open the address in Edge and use **Install this site as an
app** on each app's page: the same windows and icons.

**On the phone** (Tailscale app signed in): open the address, sign in, and on each
of `/log/`, `/hours/`, `/spending/` and `/learn/` use **Add to Home screen**: an
icon each. A note to Log is then tap the icon, tap the box, type, Add. You stay
signed in while you use it (the sign-in renews itself; 30 days unused and it asks again).

- **Android**: once Log is on the home screen, it is in the **share sheet**:
  share a photo or text to it and it is filed in today's log (a photo that
  arrives on its own waits in the inbox at the top of the day).
- **iPhone**: the camera button in Log's box takes a photo. For a quick note
  without opening anything, make a Shortcut: **Get Contents of URL**,
  `https://pi.tailXXXX.ts.net/log/api/quick`, method POST, headers
  `Authorization: Bearer <key>` and `X-Daybook: 1`, request body JSON with a
  `text` field (Dictate Text or Ask for Input before it). The key is in Admin →
  Calendar feed and phone; it opens that one door and nothing else.
- **Calendar**: Admin gives a private address to subscribe to (bills with
  amounts, paydays, days off, bank holidays, and Learn's daily review if it is
  switched on). The phone's own calendar and Outlook can reach a Tailscale
  address; a cloud calendar such as Google's cannot.

Updates on the Pi: `python3 daybook.py update` (the newest release), then
`sudo systemctl restart daybook`. Without a Pi, the PC can serve the phone the
same way: `tailscale serve --bg 8765` and
`python3 daybook.py serve --allow-host yourpc.tailXXXX.ts.net`.

## Carrying it on a stick

It is one folder of files. Keep it on an encrypted USB stick (VeraCrypt or
BitLocker To Go) and send the backups to the computer:

```sh
python3 daybook.py serve --data "E:/daybook/data" --backup-dir "C:/daybook-backups"
```

Stop Daybook before unplugging.

## Security

| | |
|---|---|
| One password | PBKDF2-SHA256; `HttpOnly`, `SameSite=Lax` cookie (so a link from Outlook arrives signed in), `Secure` over HTTPS, renewed while used and gone after 30 days unused; 8 wrong tries in 5 minutes and it waits |
| Default password | only this computer is answered until it is changed |
| `Host` header checked | stops DNS rebinding; Tailscale names only if you allow them |
| `Origin` checked on writes | stops cross-site writes |
| `X-Daybook` header on writes | a plain form cannot send it (the share sheet is let off, but still needs the cookie) |
| Calendar and phone keys | each opens one thing; Reset makes a new one |
| Bodies capped at 64 MB | photos, voice notes and receipts are checked by type in the database |

## How it fits together

```
Daybook.pyw          the app: server + its own window (Edge/Chrome in app mode)
daybook.py           serve | password | check | import | backup | export | install
core/                server (the doors), db (migrations, backups), api (tables, views,
                     undo, admin), suite (password, keys, which app uses which database)
apps/<name>/app.py   one app's hooks: its Home card, calendar events, search, endpoints
apps/<name>/migrations/, views.sql   its schema (forward only) and derived views
apps/<name>/web/     its pages; /money/x is served from apps/money/web/x, else web/x
web/core/            the shell: router, layout, menus, admin, formula engine
web/ui/              tokens.css, charts, grids, calendar, media, maths notation
web/home/            Home
apps/learn/content/  the courses, as files
```

A new figure is a `CREATE VIEW` in an app's `views.sql` (or a saved view in
Admin); it is on the API at `/<app>/api/v/<name>`. A schema change is a new
numbered file in that app's `migrations/`. A new app is a folder in `apps/`
with an `app.py`; Home and the top bar pick it up.

Tax rates live in Money's database (Settings → Tax figures). Check them each April.

## Credits

Some Learn lessons are adapted from OpenStax textbooks (Prealgebra 2e, Algebra and
Trigonometry 2e, College Physics 2e, University Physics Volume 2), © Rice University,
licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Each such
lesson names its section in its sources and links to it; the text has been rewritten,
shortened and set in engineering examples for Daybook. Download them free at
https://openstax.org.
