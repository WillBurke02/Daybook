-- Log: a diary of the day and the work day. Each day has one diary entry
-- (kind 'day', free text) and any number of work entries, each at a time if
-- you like, with photos and voice notes.

CREATE TABLE entry (
  id      INTEGER PRIMARY KEY,
  day     TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  at      TEXT CHECK (at IS NULL OR at GLOB '[0-2][0-9]:[0-5][0-9]'),
  kind    TEXT NOT NULL DEFAULT 'work' CHECK (kind IN ('day','work')),
  text    TEXT,
  -- the #words typed in the text, lower case, each with a space either side
  -- (' site ts247 '), so one LIKE '% site %' finds a tag and never part of one
  tags    TEXT,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M', 'now', 'localtime')),
  updated TEXT
);
CREATE INDEX ix_entry_day ON entry(day, at);
CREATE UNIQUE INDEX ux_entry_diary ON entry(day) WHERE kind = 'day';

-- Photos are shrunk to 1600px JPEG (240px thumbnail) in the browser; voice
-- notes are recorded there too. Both are kept here as data URLs, so the log is
-- one file. ponytail: data URLs in TEXT; move media to files if log.db passes a few GB.
CREATE TABLE attachment (
  id         INTEGER PRIMARY KEY,
  entry_id   INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('photo','voice')),
  data       TEXT NOT NULL,
  thumb      TEXT,
  duration_s REAL,
  created    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M', 'now', 'localtime')),
  CHECK ((type = 'photo' AND data GLOB 'data:image/jpeg;base64,*'
                         AND (thumb IS NULL OR thumb GLOB 'data:image/jpeg;base64,*'))
      OR (type = 'voice' AND thumb IS NULL AND duration_s <= 600
                         AND (data GLOB 'data:audio/webm;base64,*' OR data GLOB 'data:audio/mp4;base64,*'
                              OR data GLOB 'data:audio/ogg;base64,*')))
);
CREATE INDEX ix_attachment_entry ON attachment(entry_id);

-- What a phone shares arrives as it is (a PNG, a 4000px photo); the next time
-- Log is open it is shrunk to JPEG in the browser, filed on its entry, and
-- removed from here.
CREATE TABLE inbox (
  id       INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  mime     TEXT NOT NULL CHECK (mime GLOB 'image/*'),
  data     TEXT NOT NULL CHECK (data GLOB 'data:image/*;base64,*'),
  received TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M', 'now', 'localtime'))
);
