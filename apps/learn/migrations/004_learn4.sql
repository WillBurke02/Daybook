-- Learn 4: more kinds of card (explain the step, spot the mistake), and things to try on the
-- bench or on site at the end of a lesson. The card table loses its CHECK on type: the files
-- are checked as they load (read_content), so a new kind of card needs no migration again.
CREATE TABLE card_new (
  id        TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  sort      INTEGER NOT NULL DEFAULT 0,
  type      TEXT NOT NULL,
  text      TEXT,
  data      TEXT NOT NULL DEFAULT '{}',
  source    TEXT NOT NULL DEFAULT 'file' CHECK (source IN ('file','own','mistake')),
  created   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M', 'now', 'localtime')),
  level     REAL,
  stage     TEXT
);
INSERT INTO card_new (id, lesson_id, sort, type, text, data, source, created, level, stage)
  SELECT id, lesson_id, sort, type, text, data, source, created, level, stage FROM card;
DROP TABLE card;
ALTER TABLE card_new RENAME TO card;
CREATE INDEX ix_card_lesson ON card(lesson_id, sort);

ALTER TABLE lesson ADD COLUMN bench TEXT;          -- JSON [{task, check: [...]}]: try it on the bench or on site
