# Plan: Journal (Log, habits and training in one app)

Plan only; nothing in §2 onwards is built. Wireframes: the "Third go" page of the Log habits
wireframes canvas (phone: Day, a habit tapped; PC: Day, Gym). Earlier pages are kept for comparison.

## 0. Text on screen

SPEC §1 already says it: plain, short labels, no chatty helper text, no "insights". A screen holds
labels, figures, dates and buttons. It does not hold:

- sentences explaining the screen ("Figures from a watch fill The day, never over what you typed")
- comments on the data ("The three longest weeks are the three shortest for sleep")
- reassurance or disclaimers ("A missed day is not marked red", "They show what went together…")
- labels about the design itself ("new panel", "one tap each", "swipe for the next day")

Why a screen is built the way it is goes in this file, not on the screen. Empty states are a short
phrase ("Nothing logged."). The same goes for docs and changelog entries.

## 1. Done in 4.0.39

- Moving from one entry to the next no longer redraws the day under you.
- Leaving the app or closing the window saves the box being typed in (`keepalive` writes).
- Swipe left and right on a day steps days on a phone.
- `/log/api/day` says how many share-sheet pictures wait instead of carrying them.

## 2. One app: Journal

Log, habits and training become one app, so a day is in one place. **Journal** fits all three: a
diary, a training journal, a habit record. Other candidates: Days, Life.

- Inside it stays `log` (`log.db`, `apps/log/`, `/log/` addresses), so the iPhone Shortcuts and the
  share sheet (`/log/api/quick`, `/log/share`) keep working. Only `TITLE` and the labels change.
- Sidebar, each kind in its own group:

  | Group | Pages |
  |---|---|
  | (top) | Day, Timeline, Calendar |
  | Habits | Month, Rules |
  | Training | Runs, Gym, Sleep |
  | Patterns | Weeks, Compare |
  | Diary | Photos, Tags, Print |
  | Setup | Sources |

- **Day collates everything for the date**. Phone, top to bottom: quick add, Found, Habits,
  Training, Diary, Work (with Money's hours). PC: a strip of habit tiles across the top; below it
  the quick add, Found, Diary and Work on the left, Training on the right.

## 3. Habits

**Categories and tiers.** Categories are the top level (Woke, Gym, Run, Work, Learn); habits sit
under them as tiers of one fact (Woke before 6, Woke before 7). Each habit has one rule: a fact, a
comparison (before, after, at least, is, any) and a value, picked from lists on Habits → Rules.

| Category | Tiers | Fact, from |
|---|---|---|
| Woke | Before 6, Before 7 | Woke (Apple Health; typed) |
| Gym | Before 6, Before 7, Any time | Start of a strength activity (Strava) |
| Run | 5 km, Any | Run distance (Strava) |
| Work | Worked | Hours worked (Money) |
| Learn | 15 min | Learn minutes (Learn) |

**A habit row** (Day, phone and PC): the name, the day's value, the value drawn on a short scale with
the tiers' thresholds marked (`06:00`, `07:00`; `5 km`; `15 min`), and one square per tier (dark: the
first tier; grey: a lower tier; outline: none). Woke draws the night as a bar ending at the wake
time, so sleep and waking read as one. On the PC the tiles add the week as seven squares and
"3 / 4" against a weekly target. A habit with no fact (a plain tick) is a tap target with no scale.

**Tapping a row** opens a sheet: the value (Slept and Woke as times for sleep), where it came from,
the scale, each tier as Rule / Done / Not done, the week, Save. Typed values and Done / Not done
win over the rule for that day; Rule hands it back.

**Sleep boxes** show on the Day only when no sleep came in for that date.

**Habits and Training are separate sections**: habits are the yes/no record; Training is the
detail of each run and gym session.

**Tables** (a new Log migration):

```sql
CREATE TABLE category (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE habit (
  id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES category(id),
  name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
  fact TEXT NOT NULL, op TEXT NOT NULL CHECK (op IN ('before','after','at_least','is','any')), value TEXT,
  week_target INTEGER, on_home INTEGER NOT NULL DEFAULT 0, gone TEXT);
-- a day's figures as they came; one per key per source; typed wins in v_fact
CREATE TABLE fact (day TEXT NOT NULL, key TEXT NOT NULL, source TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (day, key, source));
-- a tier set by hand for a day; no row = the rule decides
CREATE TABLE mark (day TEXT NOT NULL, habit_id INTEGER NOT NULL REFERENCES habit(id), done INTEGER NOT NULL,
  PRIMARY KEY (day, habit_id));
CREATE TABLE workout (
  id INTEGER PRIMARY KEY, day TEXT NOT NULL, start TEXT, finish TEXT, kind TEXT NOT NULL, name TEXT,
  moving_s INTEGER, km REAL, climb_m REAL, hr_avg REAL, hr_max REAL,
  route TEXT,                       -- Strava's summary polyline, drawn locally (no map tiles)
  detail TEXT,                      -- splits and heart-rate zones as JSON, for the run card
  description TEXT,                 -- as Strava has it; a Hevy session's sets are in here
  strava_id INTEGER UNIQUE);
-- a gym session's sets, read from its description; none if the description cannot be read
CREATE TABLE workout_set (workout_id INTEGER NOT NULL REFERENCES workout(id) ON DELETE CASCADE,
  exercise TEXT NOT NULL, n INTEGER NOT NULL, kg REAL, reps INTEGER);
```

`v_habit_day` works out each tier for each day from `v_fact`, `workout` and `mark`. Money and Learn
have their own databases, so each app gains a `facts(db, frm, to)` hook returning `{day: {key:
value}}`, called by the suite as `days_of` calls `day()` for Home.
`ponytail:` tiers worked out in a view over every day; keep a table of results if a year gets slow.

## 4. Sources

Two, for now:

| Source | Gives | How |
|---|---|---|
| **Strava** | Runs; gym sessions (Hevy posts them there): start, finish, distance, pace, climb, splits, route; heart rate with a watch; the description | Strava API, your own API application (OAuth; refresh token in `suite.db`, like GitHub's) |
| **Apple Health** | Sleep and waking (iPhone now, a watch later); steps | iPhone Shortcut, daily: *Find Health Samples* → POST to `/log/api/health` with its own key |

Hevy is not read directly. **Gym detail comes from the Strava activity's description**, where Hevy
writes the exercises and sets. A real one (22/10/2026):

```
Push

Logged with hevyapp.com

Bench Press (Barbell)
Set 1: 20 kg x 16 [Warm-up]
Set 2: 50 kg x 8 [Warm-up]
Set 3: 70 kg x 8 
Set 4: 80 kg x 3 
Set 5: 70 kg x 9 

Overhead Press (Barbell)
Set 1: 20 kg x 10 

Triceps Rope Pushdown
Set 1: 23 kg x 11 
Set 2: 27 kg x 8 

Lateral Raise (Dumbbell)
Set 1: 10 kg x 10 
Set 2: 10 kg x 10 

Chest Fly (Machine)
Set 1: 66 kg x 6 @ 6 rpe 
Set 2: 79 kg x 8 
```

Read as: blocks split by blank lines; `Logged with hevyapp.com` and the title line are skipped; in a
block, the first line is the exercise (equipment in brackets kept as part of the name, so Lateral
Raise (Dumbbell) and (Cable) stay apart), and each `Set n: <kg> kg x <reps>` line is a set, with an
optional `[Warm-up]` (or another `[…]` set type) and `@ <n> rpe`. Lines end in a space; strip them.
A set line that does not match is kept as text on that exercise, and shown as written; nothing is
guessed. The text above goes into `tests/test_log.py` as it is.

`workout_set` gains `kind` (normal, warm-up, other `[…]` types as written) and `rpe`.

**From the sets** (warm-ups shown, greyed, and left out of every figure): top set per exercise
(heaviest working set; Bench Press 80 × 3), the same exercise last time, best top set so far,
volume (kg × reps of working sets: this session 3,327 kg over 10 sets), and on the Gym page each
exercise's top set over time and volume a week by session name (Push, Pull, Legs, as named in Hevy).
`ponytail:` volume counts a dumbbell set once, as Hevy writes it; double it per exercise if wanted.

**When Strava is fetched** (no polling):

1. When Journal is opened, if the last fetch is over 30 minutes old: one request for activities
   since then, and one per new activity for its detail.
2. A Fetch button (Setup → Sources, and on the Day when Training is empty).
3. Once at the end of the day (23:30) by the server, so the day's habits are settled and the
   Pi has them even if nothing was opened.
4. On upload: an iPhone personal automation, *When Strava or Hevy is closed* → POST
   `/log/api/strava/fetch` with the phone capture key (Appendix B). The key already opens Log's
   quick add and share; this adds one more door that can only start a fetch. Strava may not have
   the activity yet when the app closes (Hevy's post can take a minute), so the server fetches
   then and again 5 and 15 minutes later, and ignores a second call within 2 minutes (closing the
   app without recording costs one cheap call at most).
   Strava's own webhooks would be instant too, but need a public address (Tailscale Funnel on a
   one-purpose listener); not needed with the automation.

Later: Health Connect (Android) and Garmin. Garmin can post activities to Strava, so only its sleep
would need a route of its own.

## 5. Suggestions for each day

| Kind | Example | Keep? |
|---|---|---|
| Found, not in the diary | Morning Run · 5.1 km → Add to diary | Yes |
| A figure to confirm | Sleep 23:10–05:52, iPhone | Only when the source is unsure |
| How the week stands | Gym 3 / 4 | Yes, as counts on the habit tiles |
| Reminders from earlier days | `!fri` items not ticked | Already there |
| Advice | "Try to sleep earlier" | No |
| Predictions, scores | "Recovery 62%" | No |

The **Found** list sits at the top of the Day: one line, one button, a × to dismiss (remembered),
nothing added until pressed, as Money's regular-payment suggestions work. No notifications.

## 6. Screens (Third go)

- **Phone · Day**: as §2; Training shows the run (route, three figures) and the gym session (three
  figures, the first three exercises with top set and change on last time, All 6).
- **Phone · A habit, tapped**: the sheet in §3.
- **PC · Day**: habit tiles; run card (route, six figures, splits, heart-rate zones); gym card (five
  figures, a row per exercise: sets, top set, last time, top set over the last 8 sessions).
- **PC · Gym**: figures for the period; sessions list; one exercise's top set over time with best
  marks and its history; volume a week by session name.
- Still to draw: Habits → Month and Rules in the new row style, Runs, Sleep, Sources.

## 7. Widgets

Handed to a separate agent: the brief is Appendix A.

## 8. Order of work

Each step is a version (CLAUDE.md) with its check in `tests/test_log.py`.

1. Rename to Journal; sidebar groups; categories and habits, typed only; the habit row and sheet.
2. Rules and facts: typed sleep, Money and Learn through `facts()`; tiers filled in; Month.
3. Apple Health Shortcut: sleep; the sleep boxes hide when it has come in.
4. Strava: connect, fetch on open / button / end of day; runs on the Day; Found list.
5. Gym from Strava descriptions: sets, the gym card, the Gym page.
6. Patterns: Weeks, Compare. The iPhone automation for fetch on upload.
7. Later: a watch's heart rate and HRV; Health Connect; Garmin sleep.

## 9. Other Log improvements, not done

- Thumbnails as cacheable files, not data URLs inside each day's JSON.
- Redraw the panel that changed, not the whole page.
- Diary saves as you type, a second after you stop.
- Phone quick add: the Add button wraps onto its own line at 390 px.
- Timeline: one query instead of two per day shown.

## 10. Decided, and open

Decided (22/10/2026): the name is Journal; gym detail from Strava descriptions (format in §4); the
iPhone automation for fetch on upload (Appendix B); week targets Gym 4, Run 2, Woke before 6 4,
Learn 5.

Open: steps from the iPhone now, or wait for a watch?

---

## Appendix A. Brief for the widget agent

> You are designing widgets for Daybook, a personal app (Python standard library and SQLite on the
> server, plain ES modules in the browser, no build step, no framework, nothing loaded from the
> internet). It runs on a PC or a Raspberry Pi; the iPhone reaches it over Tailscale. Repository
> `willburke02/daybook`, branch `claude/charming-cerf-98smxs`. Read `CLAUDE.md`, SPEC.md §1 (text
> rules) and `PLAN-LOG.md` first. Design and plan only: build nothing until Will approves.
>
> **What exists.**
> - An iPhone home-screen widget through the free Scriptable app: `widgetScript()` in
>   `web/core/admin.js` (Admin → Calendar feed and phone). It reads `/widget/<key>.json`
>   (`widget()` in `core/server.py`), which is each app's Home figures, and draws up to three apps
>   as columns of value + label. The parameter (`money`, `learn`, `log`) limits it to one app. It
>   refreshes about every 15 minutes, as iOS allows. Will finds it poor.
> - Home (`web/home/home.js`) has three views: Today, Tiles (each app's figures as tiles, any order,
>   small or wide) and Timeline. Customise → Add a panel puts any app panel on any page.
> - Apps: Hours and pay, Spending (both Money), Log (becoming **Journal**: diary, habits, training;
>   see PLAN-LOG.md), Learn.
>
> **What is wanted.**
> 1. Habits as a widget: the habit categories with their tiers (Woke before 6 / before 7, Gym
>    before 6 / before 7 / any, Run 5 km / any, Work, Learn 15 min), today and the week.
> 2. Training: today's run or gym session, and the week's count.
> 3. Better widgets for the other apps too: payday and safe to spend (Money), today's hours, Learn's
>    cards due and daily goal.
> 4. Every size iOS offers through Scriptable: small, medium, large, and the lock-screen
>    accessory sizes (circular, rectangular, inline). Light and dark (Scriptable's `Color.dynamic`).
> 5. The same content as Home tiles and Customise panels inside Daybook, so a widget and a tile look
>    like one family.
>
> **Constraints.**
> - Text on a widget is labels, figures and dates only: no sentences, no advice, no scores, no
>   emoji. British English.
> - Scriptable widgets are not interactive: a tap opens a URL. Choose where each tap goes (the day
>   in Journal, a habit's month, an app's page).
> - Data comes only from Daybook over Tailscale with the widget key; say what the widget shows when
>   Daybook cannot be reached (it should keep the last figures and their time).
> - Propose the JSON the widget endpoint should return (an addition to `widget()`; the existing
>   shape keeps working for scripts already installed), and how one script handles every size and
>   parameter.
>
> **Deliverables.** Greyscale wireframes at real sizes for each widget and tile (Will dislikes
> explanatory text on mock-ups too), the JSON shape, the parameter scheme, and a short plan in the
> style of PLAN-LOG.md. Then stop and wait for Will.

## Appendix B. iPhone automation: fetch from Strava on upload

Works once step 6 of §8 is built (`/log/api/strava/fetch`). The phone needs Tailscale on.

1. Shortcuts → **Automation** → **+** → **App**.
2. App: **Strava** and **Hevy**. Tick **Is Closed** (untick Is Opened). **Run Immediately**; turn
   **Notify When Run** off. Next.
3. **New Blank Automation** → add **Get Contents of URL**:
   - URL: `https://<pc>.<tailnet>.ts.net/log/api/strava/fetch`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer <phone capture key>`; `X-Daybook` = `1`
   - Request Body: JSON, no fields
4. Done.

The key is the one in Admin → Calendar feed and phone → Phone capture key; Reset there stops this
automation and the Log Shortcuts together.
