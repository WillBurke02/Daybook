-- Log's derived views, rebuilt on every start.

-- An entry with what hangs off it, without the media itself.
CREATE VIEW v_entry AS
SELECT e.*,
       (SELECT COUNT(*) FROM attachment a WHERE a.entry_id = e.id AND a.type = 'photo') AS photos,
       (SELECT COUNT(*) FROM attachment a WHERE a.entry_id = e.id AND a.type = 'voice') AS voices,
       (SELECT thumb FROM attachment a WHERE a.entry_id = e.id AND a.thumb IS NOT NULL ORDER BY a.id LIMIT 1) AS thumb
FROM entry e;

-- Attachments without their data: lists load fast, the full photo loads when opened.
CREATE VIEW v_attachment AS
SELECT id, entry_id, type, thumb, duration_s, created, LENGTH(data) AS size
FROM attachment;

-- One row per day with anything logged: for the calendar's dots and the timeline.
CREATE VIEW v_log_day AS
SELECT day, SUM(kind = 'work') AS work, MAX(kind = 'day' AND TRIM(COALESCE(text, '')) <> '') AS diary,
       COUNT(*) AS entries,
       (SELECT COUNT(*) FROM attachment a JOIN entry x ON x.id = a.entry_id WHERE x.day = e.day) AS attachments
FROM entry e GROUP BY day;

-- Every tag, how often, and when last used.
CREATE VIEW v_tag AS
WITH RECURSIVE split(id, day, rest, tag) AS (
  SELECT id, day, LTRIM(tags) || ' ', NULL FROM entry WHERE TRIM(COALESCE(tags, '')) <> ''
  UNION ALL
  SELECT id, day, LTRIM(SUBSTR(rest, INSTR(rest, ' ') + 1)), SUBSTR(rest, 1, INSTR(rest, ' ') - 1)
  FROM split WHERE rest <> '' AND INSTR(rest, ' ') > 0
)
SELECT tag, COUNT(DISTINCT id) AS n, MAX(day) AS last_day
FROM split WHERE tag IS NOT NULL AND tag <> '' GROUP BY tag;
