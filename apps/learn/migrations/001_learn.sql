-- Learn: structured courses and a feed to use instead of scrolling.
-- Content (subjects, units, lessons, cards) is written in files under content/
-- and loaded here on every start, by id; your own cards and lessons are rows
-- with source 'own' and are never touched by a reload. Progress is kept in
-- tables of its own, keyed by card id, so a content update never loses it.

INSERT INTO setting (key, value) VALUES
  ('goal_kind',       'cards'),   -- cards | minutes
  ('goal',            '20'),
  ('subjects_on',     ''),        -- JSON list of subject ids; '' means every subject
  ('weights',         '{}'),      -- JSON {subject id: weight}; a missing one weighs 1
  ('review_reminder', '0');       -- 1: a daily "review in Learn" in the calendar feed

CREATE TABLE subject (
  id     TEXT PRIMARY KEY,
  title  TEXT NOT NULL,
  sort   INTEGER NOT NULL DEFAULT 0,
  note   TEXT,                                 -- which standard or exam board it follows
  source TEXT NOT NULL DEFAULT 'file' CHECK (source IN ('file','own'))
);
CREATE TABLE unit (
  id         TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  title      TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  source     TEXT NOT NULL DEFAULT 'file' CHECK (source IN ('file','own'))
);
CREATE TABLE lesson (
  id      TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  title   TEXT NOT NULL,
  sort    INTEGER NOT NULL DEFAULT 0,
  star    INTEGER NOT NULL DEFAULT 0,          -- written first
  prereq  TEXT,                                -- JSON list of lesson ids: shown, never locked
  tags    TEXT,
  note    TEXT,
  source  TEXT NOT NULL DEFAULT 'file' CHECK (source IN ('file','own'))
);
CREATE INDEX ix_lesson_unit ON lesson(unit_id, sort);
-- A card is its JSON as written (data), plus its front text for lists and search.
CREATE TABLE card (
  id        TEXT PRIMARY KEY,                  -- stable forever: progress hangs off it
  lesson_id TEXT NOT NULL,
  sort      INTEGER NOT NULL DEFAULT 0,
  type      TEXT NOT NULL CHECK (type IN ('concept','widget','mcq','numeric','steps','order','match','flash','code')),
  text      TEXT,
  data      TEXT NOT NULL DEFAULT '{}',
  source    TEXT NOT NULL DEFAULT 'file' CHECK (source IN ('file','own','mistake')),
  created   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M', 'now', 'localtime'))
);
CREATE INDEX ix_card_lesson ON card(lesson_id, sort);

-- Your own cards go in a subject of their own unless you put them in a course lesson.
-- A wrong answer's flash card (source 'mistake') stays in the lesson it came from.
INSERT INTO subject (id, title, sort, source) VALUES ('mine', 'My cards', 99, 'own');
INSERT INTO unit (id, subject_id, title, sort, source) VALUES ('mine.cards', 'mine', 'My cards', 0, 'own');

-- ---------------------------------------------------------------- progress ----
CREATE TABLE card_state (
  card_id       TEXT PRIMARY KEY,
  due           TEXT CHECK (due IS NULL OR due GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-2][0-9]:[0-5][0-9]'),
  interval_days REAL NOT NULL DEFAULT 0,
  ease          REAL NOT NULL DEFAULT 2.5 CHECK (ease >= 1.3),
  reps          INTEGER NOT NULL DEFAULT 0,
  lapses        INTEGER NOT NULL DEFAULT 0,
  last_rating   TEXT CHECK (last_rating IS NULL OR last_rating IN ('again','hard','good','easy','seen')),
  last_seen     TEXT,
  saved         INTEGER NOT NULL DEFAULT 0     -- "save for later", from the feed
);
CREATE INDEX ix_card_state_due ON card_state(due);

CREATE TABLE answer (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')),
  day        TEXT NOT NULL DEFAULT (date('now', 'localtime')),
  card_id    TEXT NOT NULL,
  lesson_id  TEXT,
  subject_id TEXT,
  mode       TEXT NOT NULL DEFAULT 'feed' CHECK (mode IN ('feed','lesson','review','practice')),
  correct    INTEGER,                          -- NULL for a card that asks nothing
  rating     TEXT,
  ms         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_answer_day ON answer(day);
CREATE INDEX ix_answer_card ON answer(card_id);

-- Where you are in each lesson, for Continue.
CREATE TABLE lesson_state (
  lesson_id TEXT PRIMARY KEY,
  pos       INTEGER NOT NULL DEFAULT 0,
  started   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M', 'now', 'localtime')),
  seen      TEXT,
  finished  TEXT
);

-- Focus time from the study timer, by subject.
CREATE TABLE study (
  id         INTEGER PRIMARY KEY,
  day        TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  subject_id TEXT,
  minutes    REAL NOT NULL CHECK (minutes > 0),
  note       TEXT
);
