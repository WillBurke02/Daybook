-- Time off in lieu, by the year, adding to the days you have.
-- It was two numbers in settings (hours earned and used, for all time); now each leave
-- year keeps the hours earned in it, and days booked as time off in lieu are what it used.
ALTER TABLE leave_year ADD COLUMN toil_hours REAL NOT NULL DEFAULT 0;   -- earned that year, in hours

INSERT OR IGNORE INTO leave_year (year, allowance)
SELECT CAST(strftime('%Y', 'now', 'localtime') AS INTEGER),
       COALESCE((SELECT allowance FROM leave_year ORDER BY year DESC LIMIT 1), 25);

-- The old totals go to this year. Hours marked used come off, unless days were booked as
-- time off in lieu this year (then those days are the use, and taking both would count it twice).
UPDATE leave_year SET toil_hours = MAX(0,
    COALESCE((SELECT CAST(value AS REAL) FROM setting WHERE key = 'toil_earned'), 0)
  - CASE WHEN EXISTS (SELECT 1 FROM leave WHERE kind = 'extra' AND substr(from_date, 1, 4) = CAST(leave_year.year AS TEXT))
         THEN 0 ELSE COALESCE((SELECT CAST(value AS REAL) FROM setting WHERE key = 'toil_used'), 0) END)
WHERE year = CAST(strftime('%Y', 'now', 'localtime') AS INTEGER);

-- How many hours make a day off. Blank: the weekly contract hours over five.
INSERT OR IGNORE INTO setting (key, value) VALUES ('leave_day_hours', '');
