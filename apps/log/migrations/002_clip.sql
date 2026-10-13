-- Videos, kept as they came from the phone (a browser cannot shrink one), up to 60 MB each.
-- clip holds what a list needs; clip_data the bytes, raw (not base64), so a phone can play one
-- from any point by asking for pieces of it.
-- clip_data has no foreign key on purpose: deleting an entry snapshots its rows for undo, and a
-- video does not belong in the change history. Its bytes stay, marked gone, for 30 days, so
-- undoing the delete (which puts the clip row back, same id: AUTOINCREMENT never reuses one)
-- finds them again. ponytail: in log.db like the rest; move media to files if it passes a few GB.
CREATE TABLE clip (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id   INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL CHECK (mime GLOB 'video/*'),
  size       INTEGER NOT NULL,
  thumb      TEXT CHECK (thumb IS NULL OR thumb GLOB 'data:image/jpeg;base64,*'),
  duration_s REAL,
  created    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M', 'now', 'localtime'))
);
CREATE INDEX ix_clip_entry ON clip(entry_id);

CREATE TABLE clip_data (
  clip_id INTEGER PRIMARY KEY,
  data    BLOB NOT NULL,
  gone    TEXT
);

CREATE TRIGGER clip_gone AFTER DELETE ON clip BEGIN
  UPDATE clip_data SET gone = strftime('%Y-%m-%d %H:%M', 'now', 'localtime') WHERE clip_id = OLD.id;
END;
CREATE TRIGGER clip_back AFTER INSERT ON clip BEGIN
  UPDATE clip_data SET gone = NULL WHERE clip_id = NEW.id;
END;
