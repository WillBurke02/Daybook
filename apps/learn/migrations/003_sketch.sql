-- Learn 4: your working on the whiteboard, one board per card, kept so that when the
-- card comes back it can show you how you did it last time.
CREATE TABLE sketch (
  card_id TEXT PRIMARY KEY,
  strokes TEXT NOT NULL DEFAULT '[]',   -- JSON [{c: colour 0-3, w: width, p: [[x, y, pressure], …]}], x 0-1000 across the board
  paper   TEXT CHECK (paper IS NULL OR paper IN ('plain', 'squared', 'graph')),
  updated TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M', 'now', 'localtime'))
);
