-- Your GitHub activity, kept here: GitHub's own list forgets after 90 days. One row a commit (its sha)
-- or an event (its id); day and at are in local time, for the day it shows on in Log.
CREATE TABLE gh_event (
  id   TEXT PRIMARY KEY,
  day  TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  at   TEXT,
  repo TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- commit, pr, issue, review, comment, release, create
  text TEXT NOT NULL,
  url  TEXT
);
CREATE INDEX ix_gh_event_day ON gh_event(day, at);
