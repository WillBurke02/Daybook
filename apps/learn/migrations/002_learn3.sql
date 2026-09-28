-- Learn 3: FSRS scheduling, levels, the lesson template, notes, struggles.
-- Every existing row stays: columns are added, and the one table whose CHECK
-- changes (answer) is copied across, not dropped with its rows.

-- the content files now say how hard each card and lesson is, and what a card is for
ALTER TABLE card ADD COLUMN level REAL;             -- a stage, 1 to 9 (level.py); a card without one takes its lesson's
ALTER TABLE card ADD COLUMN stage TEXT;             -- its place in a lesson: try, learn, example, practise, mix, check
ALTER TABLE lesson ADD COLUMN level REAL;
ALTER TABLE lesson ADD COLUMN kind TEXT;            -- procedure, concept or facts
ALTER TABLE lesson ADD COLUMN minutes INTEGER;
ALTER TABLE lesson ADD COLUMN goals TEXT;           -- JSON: what you can do by the end
ALTER TABLE lesson ADD COLUMN summary TEXT;         -- the lesson's notes: key points and formulas
ALTER TABLE lesson ADD COLUMN resources TEXT;       -- JSON: reading and watching, before or after
ALTER TABLE lesson ADD COLUMN sources TEXT;         -- JSON: what the lesson was checked against
ALTER TABLE unit ADD COLUMN level REAL;

-- FSRS alongside the old SM-2 columns, which stay (nothing is thrown away)
ALTER TABLE card_state ADD COLUMN stability REAL;
ALTER TABLE card_state ADD COLUMN difficulty REAL;
ALTER TABLE card_state ADD COLUMN phase TEXT CHECK (phase IS NULL OR phase IN ('learning','review','relearning'));
ALTER TABLE card_state ADD COLUMN last_review TEXT;
ALTER TABLE card_state ADD COLUMN right_days INTEGER NOT NULL DEFAULT 0;   -- separate days right since the last miss
ALTER TABLE card_state ADD COLUMN last_right_day TEXT;
ALTER TABLE card_state ADD COLUMN struggle INTEGER NOT NULL DEFAULT 0;     -- in Coming back until right on 3 days
-- cards already scheduled by SM-2: the interval as the stability, the ease as a difficulty
UPDATE card_state SET stability = MAX(interval_days, 0.5),
                      difficulty = MIN(10.0, MAX(1.0, 5 + (2.5 - ease) * 10.0 / 3)),
                      phase = 'review', last_review = COALESCE(last_seen, strftime('%Y-%m-%d %H:%M', 'now', 'localtime'))
 WHERE reps > 0;
UPDATE card_state SET stability = 0.5, difficulty = MIN(10.0, MAX(1.0, 5 + (2.5 - ease) * 10.0 / 3)),
                      phase = 'relearning', last_review = COALESCE(last_seen, strftime('%Y-%m-%d %H:%M', 'now', 'localtime'))
 WHERE reps = 0 AND due IS NOT NULL AND lapses > 0;

-- answers: more ways in (calibration, checkpoints, test out, the weekly comeback),
-- how sure you were, the card's stage at the time, and whether it counts towards your level
CREATE TABLE answer_new (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')),
  day        TEXT NOT NULL DEFAULT (date('now', 'localtime')),
  card_id    TEXT NOT NULL,
  lesson_id  TEXT,
  subject_id TEXT,
  mode       TEXT NOT NULL DEFAULT 'feed'
             CHECK (mode IN ('feed','lesson','review','practice','calibrate','checkpoint','testout','comeback')),
  correct    INTEGER,
  rating     TEXT,
  ms         INTEGER NOT NULL DEFAULT 0,
  confidence INTEGER CHECK (confidence IS NULL OR confidence IN (0, 1, 2)),   -- guess, think so, sure
  level      REAL,                                   -- the card's stage when it was asked
  floor      REAL NOT NULL DEFAULT 0,                -- the chance of guessing it (1/options)
  cold       INTEGER NOT NULL DEFAULT 0              -- 1: counts towards your level
);
INSERT INTO answer_new (id, at, day, card_id, lesson_id, subject_id, mode, correct, rating, ms)
  SELECT id, at, day, card_id, lesson_id, subject_id, mode, correct, rating, ms FROM answer;
DROP TABLE answer;
ALTER TABLE answer_new RENAME TO answer;
CREATE INDEX ix_answer_day ON answer(day);
CREATE INDEX ix_answer_card ON answer(card_id);
CREATE INDEX ix_answer_subject ON answer(subject_id, cold);

ALTER TABLE lesson_state ADD COLUMN placed TEXT CHECK (placed IS NULL OR placed IN ('known','start'));
ALTER TABLE lesson_state ADD COLUMN learned TEXT;   -- the day its check was passed (or it was tested out)
ALTER TABLE lesson_state ADD COLUMN notes TEXT;     -- your own notes on it

-- your level in each subject and unit, as last worked out, and its history for the chart
CREATE TABLE skill (
  scope   TEXT PRIMARY KEY,                          -- a subject id or a unit id
  theta   REAL NOT NULL,
  sd      REAL NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,               -- counted answers
  prior   REAL,                                     -- where you said you were, for a subject
  placed  TEXT,                                     -- when you last calibrated
  updated TEXT
);
CREATE TABLE skill_log (
  day   TEXT NOT NULL,
  scope TEXT NOT NULL,
  theta REAL NOT NULL,
  sd    REAL NOT NULL,
  why   TEXT,
  PRIMARY KEY (day, scope)
);

-- "Report a problem" on a card: it goes on the Needs rework list
CREATE TABLE report (
  id      INTEGER PRIMARY KEY,
  card_id TEXT NOT NULL,
  at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M', 'now', 'localtime')),
  note    TEXT,
  done    INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO setting (key, value) VALUES
  ('desired_retention',  '0.9'),
  ('confidence_taps',    '1'),
  ('calibration_length', '15'),
  ('comeback_day',       '0');       -- 0 Sunday … 6 Saturday: the weekly comeback
