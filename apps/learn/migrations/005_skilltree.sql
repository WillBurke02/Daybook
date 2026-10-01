-- Skill tree: the badges you have earned (each is announced once and keeps its date).
-- XP, rank, a lesson's state and your route to a goal are worked out from the answers, not stored.
CREATE TABLE badge (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M', 'now', 'localtime'))
);
