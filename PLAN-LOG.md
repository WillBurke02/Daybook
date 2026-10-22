# Plan: Log and Routine

Plan only; nothing in §2 onwards is built. Wireframes: the "Second go" page of the Log habits
wireframes canvas (phone: Today, Today with no sleep, Month, Home and the iPhone widget; PC: Today,
Weeks, Habits and rules).

## 0. Text on screen

SPEC §1 already says it: plain, short labels, no chatty helper text, no "insights". The first
wireframes broke it, so to be exact. A screen holds labels, figures, dates and buttons. It does not
hold:

- sentences explaining the screen ("Figures from a watch fill The day, never over what you typed")
- comments on the data ("The three longest weeks are the three shortest for sleep")
- reassurance or disclaimers ("A missed day is not marked red", "They show what went together…")
- labels about the design itself ("new panel", "one tap each", "swipe for the next day")

Why a screen is built the way it is goes in this file, not on the screen. Empty states are a short
phrase ("Nothing logged."). The same goes for docs and changelog entries: say what changed, no
flourishes.

## 1. Done in 4.0.39

- Moving from one entry to the next no longer redraws the day under you.
- Leaving the app or closing the window saves the box being typed in (`keepalive` writes).
- Swipe left and right on a day steps days on a phone.
- `/log/api/day` says how many share-sheet pictures wait instead of carrying them; Log asks for them
  only then.

## 2. Structure: one database, two doors

Log becomes two front doors on `log.db`, as Money is two (Hours and pay, Spending):

| Door | Sidebar |
|---|---|
| **Log** | Day, Timeline, Calendar, Photos, Tags, Print |
| **Routine** | **Habits**: Today, Month · **Training**: Workouts, Sleep · **Patterns**: Weeks, Compare · **Setup**: Habits and rules, Sources |

- Habits and patterns get their own sidebar groups and their own tab on the phone.
- One database, because the two share days, undo, backups, sync and the GitHub backup. A door is
  a few lines (`DOORS` in `app.py`, a `door` table in `web/app.js`, as `apps/money/web/app.js`).
- The app is still `log` inside (`log.db`, `apps/log/`); only the doors' titles show.
- **Name**: Routine. It covers waking, gym, runs, work and learning without claiming to be medical.
  Other candidates: Habits (narrower), Training (leaves out sleep and work), Health (too broad).

## 3. Habits: categories, tiers, rules

**Categories** are the top level; **habits** sit under them. Habits in one category usually share a
fact and differ in a threshold, so they form tiers:

| Category | Habits (tiers) | Done when |
|---|---|---|
| Sleep | Woke before 6, Woke before 7, 7 hours | Woke before 06:00 / 07:00; Sleep at least 7 h |
| Gym | Gym before 6, Gym before 7, Gym | Strength workout starts before 06:00 / 07:00; any |
| Running | Run, Run 5 km | Run, any; Run distance at least 5 km |
| Work | Worked | Hours worked (Money) more than 0 |
| Learning | Learning, Review done | Learn minutes at least 15; Cards due (Learn) is 0 |

**Rules fill habits in.** Each habit has one rule: a fact, a comparison (before, after, at least, is,
any) and a value, picked from lists in Setup → Habits and rules (no formula language). A day's habits
are worked out from that day's facts whenever a fact arrives (a Strava run, last night's sleep, a
shift in Money). Woke at 05:52 ticks both Woke before 6 and Woke before 7.

**Typing always wins.** Tapping a tier sets it by hand (done or not done) for that day, and the
rule no longer touches it. A second option on the same tap puts it back to the rule. This keeps
"explicit over inferred": the rules are yours, and every result can be overridden.

**Shown as**: dark = first tier done, mid grey = a lower tier done, outline = none. One row per
category in the month grid, so tiers do not multiply the rows.

**Facts** and where each comes from:

| Fact | From |
|---|---|
| Slept, Woke, Sleep length | Apple Health (iPhone now, a watch later); typed |
| Workout: kind, start, minutes, distance, heart rate, route | Strava (runs; Hevy sessions arrive there too) |
| Exercises and sets | Hevy |
| Steps, resting heart rate, HRV | Apple Health (most need a watch) |
| Hours worked, shift start | Money (`shift`) |
| Learn minutes, cards due | Learn |
| A tag used that day | Log entries |

Money and Learn have their own databases, so each app gains a `facts(db, frm, to)` hook returning
`{day: {key: value}}`, called by the suite as `days_of` calls `day()` for Home.

**Tables** (a new Log migration):

```sql
CREATE TABLE category (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE habit (
  id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES category(id),
  name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
  fact TEXT NOT NULL, op TEXT NOT NULL CHECK (op IN ('before','after','at_least','is','any')), value TEXT,
  week_target INTEGER, on_home INTEGER NOT NULL DEFAULT 0, gone TEXT);
-- a day's figures as they came; one per key per source, the preferred source wins in v_fact
CREATE TABLE fact (day TEXT NOT NULL, key TEXT NOT NULL, source TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (day, key, source));
-- a habit set by hand for a day; no row = the rule decides
CREATE TABLE mark (day TEXT NOT NULL, habit_id INTEGER NOT NULL REFERENCES habit(id), done INTEGER NOT NULL,
  PRIMARY KEY (day, habit_id));
CREATE TABLE workout (
  id INTEGER PRIMARY KEY, day TEXT NOT NULL, start TEXT, kind TEXT NOT NULL, name TEXT,
  minutes REAL, km REAL, climb_m REAL, hr_avg REAL, hr_max REAL, route TEXT,   -- route: Strava's polyline
  source TEXT NOT NULL, ext TEXT, UNIQUE (source, ext));
CREATE TABLE workout_set (workout_id INTEGER NOT NULL REFERENCES workout(id) ON DELETE CASCADE,
  exercise TEXT NOT NULL, n INTEGER NOT NULL, kg REAL, reps INTEGER, pr INTEGER NOT NULL DEFAULT 0);
```

A view `v_habit_day` works out each habit for each day from `v_fact`, `workout` and `mark`.
`ponytail:` rules worked out in a view over every day; keep a table of results if a year gets slow.

## 4. Sources

| Source | Gives | How | Online? |
|---|---|---|---|
| **Strava** | Runs; gym sessions (Hevy posts them); start, time, distance, climb, heart rate, splits, route | Strava API with your own API application (OAuth, refresh token in `suite.db` like the GitHub token). Fetched every 15 min while Routine is open and daily on the Pi. Webhooks need a public address, so no webhooks behind Tailscale. | Yes, opt-in |
| **Apple Health** | Sleep (iPhone now), steps; heart rate and HRV with a watch | iPhone Shortcut, daily at 09:00: *Find Health Samples*, then POST to `/routine/api/health` with its own key. Earlier years: import Health's `export.zip` (`xml.etree.iterparse`). | No |
| **Hevy** | Exercises, sets, kg × reps | Hevy's API (needs Hevy Pro), or its CSV export. Matched to Strava's session by start time, so one workout, not two. | API: yes, opt-in |
| Health Connect (later) | Android sleep, steps, workouts | An automation app posting the same JSON as the Shortcut | No |
| Garmin (later) | Activities; sleep | Activities through Strava (Garmin Connect can post there); sleep from `.FIT` by cable or Health Connect | No |

Strava would be the second thing (after GitHub) to fetch from the internet. It stays off until
you connect it, and everything it sends is kept in `log.db`.

When two sources give the same thing: typed beats everything; then Hevy over Strava for gym;
Apple Health is the only sleep source for now.

## 5. Suggestions for each day

What a suggestion could be, and whether it belongs:

| Kind | Example | Keep? |
|---|---|---|
| Something found that is not in the diary | Strava · Morning Run · 5.1 km → Add to diary | Yes |
| A figure to confirm | Sleep 23:10–05:52 from the iPhone → Use / type over | Only when the source is unsure (iPhone sleep without a watch) |
| How the week stands | Gym 3 / 4 · Run 2 / 2 | Yes, as counts, no wording |
| Reminders left from earlier days | `!fri` items not ticked | Already there |
| Advice | "Try to sleep earlier" | No: opinion, and the text SPEC §1 rules out |
| Predictions, scores | "Recovery 62%" | No: inferred, not yours |

So the day gets a **Found** list at the top: one line per item, one button, a × to dismiss
(remembered), nothing added until pressed, as Money's regular-payment suggestions work. At most a
handful, no notifications. "This week" is a block of counts, not a suggestion.

## 6. Screens

- **Routine → Today (phone)**: Found; Habits (category rows with tier buttons); Sleep (times,
  length, a bar); Workouts (two figures each); This week (seven squares a habit, n / target); a link
  to the day in Log.
- **Sleep boxes**: Slept and Woke inputs show only when nothing came in for that day.
- **Routine → Today (PC)**: three columns. Left: Found, Habits. Middle: each workout in full: route
  drawn from Strava's polyline (no map tiles: nothing online), six figures, splits with pace and heart
  rate, heart rate zones; a gym session as exercises × sets (kg × reps, PRs marked) with volume.
  Right: Sleep with the last 7 nights, Work (Money), Learning (Learn), This week, the diary link.
- **Month**: category rows × days, shaded by tier, counts per tier; 14 nights of sleep; month totals.
- **Patterns → Weeks**: hours worked and sleep; workouts (gym, runs); wake time each day (work days
  and days off); running km and pace. **Compare**: one table of day groups (gym before 7, no gym,
  ran, over 9 h worked, `#site`, weekends) against sleep, waking, Learn minutes and steps, with how
  many days each is from. No captions.
- **Setup → Habits and rules**: the category tree, rules as three pickers, week target, on Home.
  **Sources**: each with what it gives, how it arrives, last received, one button.

## 7. Home and widgets

- Home → Today: a Routine card, the habits marked "Home" with their tiers.
- Home → Tiles: the same as a tile, small or wide.
- Customise → Add a panel: "Habits" on any page.
- iPhone home screen: the existing Scriptable widget (Admin → phone) takes the parameter `routine`
  for the habits, small or medium.

## 8. Order of work

Each step is a version (CLAUDE.md) with its check in `tests/test_log.py`.

1. The Routine door, categories and habits, typed only; Today and Month; Home card.
2. Rules and facts: woke/slept typed, Money and Learn facts through `facts()`; tiers filled in.
3. Apple Health Shortcut: sleep; the sleep boxes hide when it has come in.
4. Strava: connect, fetch, workouts on Today; Found list.
5. Hevy: sets matched to Strava's sessions; PC workout detail.
6. Patterns: Weeks, Compare. Scriptable widget parameter.
7. Later: Health Connect, Garmin, a watch's heart rate and HRV.

## 9. Other Log improvements, not done

- Thumbnails as cacheable files, not data URLs inside each day's JSON.
- Redraw the panel that changed, not the whole page.
- Diary saves as you type, a second after you stop.
- Phone quick add: the Add button wraps onto its own line at 390 px.
- Timeline: one query instead of two per day shown.

## 10. Open questions

- Routine as the name?
- Strava fetched from the internet (opt-in, like GitHub): all right?
- Hevy Pro? It decides API or CSV for sets.
- Week targets (Gym 4, Learning 5): wanted?
- Steps from the iPhone: wanted now, or wait for a watch?
