-- What you would change about Daybook, written from any page (Help → Suggest a change),
-- with where you were, so it can be found again. Admin → Suggestions lists them to copy.
CREATE TABLE suggestion (
  id      INTEGER PRIMARY KEY,
  text    TEXT NOT NULL CHECK (TRIM(text) <> ''),
  app     TEXT,                    -- the app and page it was written on
  page    TEXT,
  screen  TEXT,                    -- the window's size, e.g. 390×844 (a phone)
  version TEXT,
  created TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  done    TEXT                     -- when it was dealt with
);
