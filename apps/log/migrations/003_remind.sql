-- A reminder written in an entry: !fri, !tomorrow 9:00, !16/10, !3d. remind is when (YYYY-MM-DD, or
-- YYYY-MM-DD HH:MM), worked out from the text against the entry's own day, as tags are; reminded is
-- when it was ticked off. It shows on its day in Log and, with an alert, in the calendar feed.
ALTER TABLE entry ADD COLUMN remind TEXT;
ALTER TABLE entry ADD COLUMN reminded TEXT;
CREATE INDEX ix_entry_remind ON entry(remind) WHERE remind IS NOT NULL;
