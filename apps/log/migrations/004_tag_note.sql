-- What a tag stands for, in your own words: #ts247 is "the Siemens S7-1500 on line 2, Leeds".
-- Shown with the tag: on the Tags page, at the top of its timeline, and when pointing at its chip.
CREATE TABLE tag_note (
  tag  TEXT PRIMARY KEY CHECK (tag <> '' AND tag = lower(tag)),
  note TEXT NOT NULL CHECK (TRIM(note) <> '')
);
