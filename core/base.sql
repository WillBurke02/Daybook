-- The toolkit's own tables, which every app's database has: settings, the
-- change history that undo replays, saved page layouts, saved views, column
-- labels and your own wording. Created if missing, before the app's own
-- migrations, which may then fill in settings.

CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS change_log (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  action    TEXT NOT NULL,          -- import | edit | delete | remap | rescan | setting
  entity    TEXT NOT NULL,          -- table or concept the change touched
  entity_id TEXT,
  summary   TEXT NOT NULL,          -- one line, written for a human
  detail    TEXT,                   -- JSON: enough to reverse it where reversible
  rows      INTEGER NOT NULL DEFAULT 0,
  undone    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_change_at ON change_log(at DESC);

CREATE TABLE IF NOT EXISTS layout (
  page   TEXT PRIMARY KEY,
  title  TEXT,
  panels TEXT NOT NULL,              -- JSON
  sort   INTEGER NOT NULL DEFAULT 100,
  custom INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS custom_view (
  name TEXT PRIMARY KEY CHECK (name GLOB 'cv_[a-z0-9_]*'),
  sql  TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS field_meta (
  tbl    TEXT NOT NULL,
  col    TEXT NOT NULL,
  label  TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tbl, col)
);

CREATE TABLE IF NOT EXISTS ui_text (
  original TEXT PRIMARY KEY,
  text     TEXT NOT NULL
);
