-- The skill map: a stop is proven once its bench task is done for real and logged (a date).
-- Goals are tracks now (setting goal_track); the old lesson goal goes.
ALTER TABLE lesson_state ADD COLUMN proven TEXT;
DELETE FROM setting WHERE key = 'goal_lesson';
