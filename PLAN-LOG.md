# Plan: Log, the day, habits and a watch

What Log could add next, and in what order. Nothing here is built yet except §1.
Wireframes (greyscale, phone and PC) were drawn alongside this plan; the screens are
described in §2 so this file stands on its own.

## 1. Done in 4.0.39 (UX and speed)

- Editing one entry and moving to the next no longer redraws the day under you (it lost the box
  you had moved to and, on a phone, closed the keyboard). The redraw waits until you leave the box.
- Leaving the app (another app on the phone, the window closed) saves the box being typed in;
  small writes are sent with `keepalive` so they outlive the page.
- Swipe left and right on a day steps days on a phone, as `[` and `]` do on a PC.
- `/log/api/day` no longer carries every picture waiting in the share-sheet inbox (base64, up to
  25 MB each, and the phone's offline layer kept a copy of each answer); it says how many wait,
  and Log fetches them only then, not on every page.

## 2. The idea

Log already holds the day in words. Some of the day is better as a few figures: when you woke,
when you slept, whether you trained, a handful of habits ticked off. Typed in a second, or filled
in by a watch, they sit beside the diary and Money's hours, and over weeks they show plain
patterns: the long weeks are the short-sleep weeks; site days are the 12,000-step days.

The rules still hold: explicit over inferred, everything editable and undoable, no "insights"
wording, nothing online at run time unless asked for.

**Screens** (the wireframes):

- **Day → The day** (a new panel, above Diary on a phone, beside Hours on a PC). Woke and slept
  (times, with the hours between), exercise as chips (`Run · 32 min · 5.1 km`, `+ Add`), habits
  as one-tap chips (○ not done, ● done; 44 px targets), and one grey line of watch figures (steps,
  resting heart rate, HRV). A figure from the watch shows grey in a dashed box; typing over it
  wins, as Money's usual start and finish do.
- **Habits** (new page). A month as a grid: a row per habit, a square per day, with "18 of 22 ·
  run 5" beside each. A missed day is an empty square, never red. Under it, sleep for the last
  14 nights as bars from bedtime to waking, and the month's exercise in one line.
- **Patterns** (new page, PC first). A period picker. Hours worked (Money) and sleep by week;
  resting heart rate by week, overtime weeks darker; and a table, *Side by side*: days with and
  without exercise, `#site` days, days over 9 h worked, against sleep that night, steps and Learn
  minutes, each with how many days it is from. A line under it: they show what went together, not
  what caused what.
- **Admin → Watch**. How the figures arrive (below), which to keep (sleep, workouts, steps,
  heart rate; GPS routes off), the key, and when the last ones came, with Undo.

## 3. Data

A new migration, `apps/log/migrations/006_habit.sql`:

```sql
-- What is kept for a day besides the words: woke and slept, steps, resting heart rate, and your
-- own habits. kind decides how a value is typed and shown.
CREATE TABLE habit (
  key   TEXT PRIMARY KEY CHECK (key GLOB '[a-z0-9]*'),   -- woke, slept, steps, rhr, hrv, read, stretch…
  label TEXT NOT NULL,
  kind  TEXT NOT NULL CHECK (kind IN ('tick', 'time', 'number')),
  unit  TEXT,
  sort  INTEGER NOT NULL DEFAULT 0,
  shown INTEGER NOT NULL DEFAULT 1                       -- 0: kept, not offered on the day
);
-- One value a day per habit per source: what you typed and what the watch sent are both kept,
-- and yours is the one shown (v_mark). A tick is '1'; a time 'HH:MM'; a number as written.
CREATE TABLE mark (
  day    TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  key    TEXT NOT NULL REFERENCES habit(key) ON UPDATE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('typed', 'watch')),
  value  TEXT NOT NULL,
  PRIMARY KEY (day, key, source)
);
-- A session of exercise. ext is the watch's own id, so sending the same day twice adds nothing.
CREATE TABLE workout (
  id      INTEGER PRIMARY KEY,
  day     TEXT NOT NULL,
  at      TEXT,
  kind    TEXT NOT NULL,                                 -- run, gym, walk, cycle, swim…
  minutes REAL,
  km      REAL,
  source  TEXT NOT NULL DEFAULT 'typed' CHECK (source IN ('typed', 'watch')),
  ext     TEXT UNIQUE
);
```

`views.sql` gains `v_mark` (typed over watch, one row a day per key) and `v_sleep` (slept the
evening before to woke, so a night after midnight is still one night). Woke and slept are rows in
`habit` seeded by the migration, so there is one way of storing everything.

**Patterns** joins Log with Money's hours and Learn's minutes. Each app has its own database, so
the page fetches each app's daily view through its own API (as the Day page's Hours panel does
now) and lines them up by date in the browser; a year is 365 rows each.
`ponytail:` joined in the browser; move to an `ATTACH` on the server if it gets slow.

## 4. Getting figures from a watch

Daybook is offline and has no cloud of its own, so the phone sends what the watch knows, the way
the iOS share Shortcut already does. One new door, `POST /log/api/watch`, with its own key (Admin
→ Watch, Reset makes a new one), taking

```json
{ "day": "2026-10-21", "woke": "06:40", "slept": "23:10", "steps": 8412, "rhr": 54, "hrv": 48,
  "workouts": [{ "id": "…", "kind": "run", "at": "07:05", "minutes": 32, "km": 5.1 }] }
```

Sending the same day again replaces the watch's values for it; your typed values are never touched.

| Watch | Route in | Notes |
|---|---|---|
| Apple Watch | Shortcut: *Find Health Samples* (sleep, steps, resting HR, HRV, workouts) → *Get Contents of URL*, daily at 09:00 | No web API for Apple Health: this is the only live route. Also an import of Health's `export.zip` (`xml.etree.iterparse`, standard library) for the years before. |
| Android, Wear OS, Galaxy, Pixel | Health Connect is on the phone only: an automation app posts the same JSON; or import an exported CSV | Check what the chosen app can read before promising a figure. |
| Garmin | Plugged in by cable, the watch is a USB drive of `.FIT` files: read activities from them (FIT is a small binary format; a standard-library reader is a few hundred lines) | Fits the USB-stick, nothing-online rule. Sleep is harder to get from FIT than activities. |
| Fitbit, Oura, Whoop, Polar | Cloud APIs only | Would break "nothing online". Only if the phone routes fail, and opt-in like GitHub. |

**What a watch gives that is worth having here:** sleep (bedtime, waking, length), workouts (kind,
minutes, distance), steps, resting heart rate and HRV (both drift up with strain and short sleep),
and VO₂ max as a slow trend. Skip the rest (stress scores, "body battery", sleep stages): they are
the maker's estimates, and they change when the maker changes them.

**What it could show, plainly** (the Patterns page): long weeks against short nights; resting heart
rate in overtime weeks; steps on `#site` days; whether exercise days are better Learn days. Always
as averages side by side with how many days each is from. No scores, no advice.

## 5. Order of work

Each step is a version (CLAUDE.md), with its check in `tests/test_log.py`.

1. **The day, typed** (4.0.40). `006_habit.sql`, woke/slept and ticks on the Day page, Admin →
   Habits to add, rename, reorder and hide. Undo on every tick. Home's Log card shows woke and
   habits done.
2. **Habits page** (4.0.41). The month grid, runs, the sleep bars.
3. **Watch** (4.0.42). `/log/api/watch` and its key, Admin → Watch with the Shortcut's steps,
   grey watch values, Apple Health `export.zip` import.
4. **Exercise and Patterns** (4.0.43). Workouts on the day and the Habits page; the Patterns page.
5. **Later, if wanted**: Garmin `.FIT` by cable; workouts in the calendar feed; a habit made from
   a tag (`#gym` in an entry ticks Gym), though that is the kind of smartness the spec warns about.

## 6. Other improvements for Log, not yet done

- **Thumbnails as files, not data URLs.** Every day and timeline fetch sends its thumbnails again
  inside the JSON, and the offline layer keeps a copy per address. A `/log/thumb/<id>` the browser
  caches would make photo-heavy days much lighter.
- **Redraw the panel, not the page.** An edit redraws the whole day (`ctx.reload`); now that it
  waits for you to leave the box this is fine, but panel refreshes would be smoother still.
- **Diary saves as you type**, a second after you stop, now that a save no longer moves the page.
- **Quick add on a phone**: at 390 px the Add button wraps onto a line of its own.
- **Timeline** runs two queries a day it shows; one query would do when logs get long.
- **Skipped on purpose**: fetching the days either side ahead of time. The server answers a day in
  about 15 ms, and a cache that outlives Undo would show a day as it was.

## 7. Questions for Will

- Which watch? That decides which route in §4 to build first.
- Which habits, and are they all ticks, or some numbers (litres of water, pages read)?
- Woke and slept typed without a watch: worth the panel on its own?
- Should habits show on Home's Today, or only in Log?
