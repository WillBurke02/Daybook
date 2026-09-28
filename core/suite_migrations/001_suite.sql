-- The store every app shares. Nothing personal: the password hash and the keys
-- (secret), themes, which database file each app opens. Settings and the
-- change history come from core/base.sql, as for any app.
CREATE TABLE secret (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE theme (
  name   TEXT PRIMARY KEY,
  scheme TEXT NOT NULL DEFAULT 'light' CHECK (scheme IN ('light','dark')),
  vars   TEXT NOT NULL DEFAULT '{}'
);

-- Relative to the data folder when the file is inside it.
CREATE TABLE app_db (app TEXT PRIMARY KEY, path TEXT NOT NULL);
