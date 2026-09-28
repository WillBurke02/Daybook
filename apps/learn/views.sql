-- Learn's derived views, rebuilt on every start.

-- Every card with where it sits and how it stands with you. A card is solid when
-- FSRS expects you to remember it for three weeks or more, or you have got it right
-- on three separate days since you last missed it (successive relearning).
CREATE VIEW v_card AS
SELECT c.id, c.lesson_id, c.sort, c.type, c.text, c.source, l.title AS lesson, l.unit_id, u.title AS unit,
       u.subject_id, s.title AS subject,
       (c.type <> 'concept' AND COALESCE(json_extract(c.data, '$.worked'), 0) = 0) AS asks,
       COALESCE(c.level, l.level) AS level, c.stage,
       st.due, st.interval_days, st.ease, st.reps, st.lapses, st.last_rating, st.last_seen, COALESCE(st.saved, 0) AS saved,
       st.stability, st.difficulty, st.phase, st.last_review, COALESCE(st.right_days, 0) AS right_days,
       COALESCE(st.struggle, 0) AS struggle,
       (c.type <> 'concept' AND COALESCE(json_extract(c.data, '$.worked'), 0) = 0
        AND (st.stability >= 21 OR (st.right_days >= 3 AND st.struggle = 0))) AS solid,
       COALESCE(st.lapses, 0) >= 4 AS leech
FROM card c
JOIN lesson l ON l.id = c.lesson_id
JOIN unit u ON u.id = l.unit_id
JOIN subject s ON s.id = u.subject_id
LEFT JOIN card_state st ON st.card_id = c.id;

-- A lesson: how many cards, how many seen, how many solid ("mastered"), due now.
CREATE VIEW v_lesson AS
SELECT l.id, l.title, l.unit_id, u.title AS unit, u.subject_id, s.title AS subject, l.sort, u.sort AS unit_sort,
       s.sort AS subject_sort, l.star, l.prereq, l.tags, l.source, l.level, l.kind, l.minutes,
       SUM(c.id IS NOT NULL AND COALESCE(c.stage, '') <> 'calibrate') AS cards,   -- bank questions place you; they are not the lesson
       SUM(c.type <> 'concept' AND COALESCE(json_extract(c.data, '$.worked'), 0) = 0 AND COALESCE(c.stage, '') <> 'calibrate') AS asks,
       SUM(COALESCE(c.stage, '') = 'calibrate') AS bank,
       SUM(st.card_id IS NOT NULL) AS seen,
       SUM(c.type <> 'concept' AND COALESCE(json_extract(c.data, '$.worked'), 0) = 0
           AND (st.stability >= 21 OR (st.right_days >= 3 AND st.struggle = 0))) AS mastered,
       SUM(st.due IS NOT NULL AND st.due <= strftime('%Y-%m-%d %H:%M', 'now', 'localtime')) AS due,
       SUM(COALESCE(st.struggle, 0)) AS struggles,
       ls.pos, ls.started, ls.seen AS opened, ls.finished, ls.placed, ls.learned,
       ls.notes IS NOT NULL AND ls.notes <> '' AS has_notes, l.summary IS NOT NULL AS has_summary
FROM lesson l
JOIN unit u ON u.id = l.unit_id
JOIN subject s ON s.id = u.subject_id
LEFT JOIN card c ON c.lesson_id = l.id AND c.source <> 'mistake'
LEFT JOIN card_state st ON st.card_id = c.id
LEFT JOIN lesson_state ls ON ls.lesson_id = l.id
GROUP BY l.id;

CREATE VIEW v_subject AS
SELECT subject_id AS id, subject AS title, subject_sort AS sort, COUNT(*) AS lessons, SUM(cards > 0) AS written,
       SUM(cards) AS cards, SUM(asks) AS asks, SUM(bank) AS bank, SUM(seen) AS seen, SUM(mastered) AS mastered, SUM(due) AS due,
       SUM(learned IS NOT NULL) AS learned, SUM(struggles) AS struggles
FROM v_lesson GROUP BY subject_id;

-- Each day: cards answered, how many right first time, minutes (answers plus the study timer).
CREATE VIEW v_learn_day AS
SELECT day, SUM(cards) AS cards, SUM(correct) AS correct, SUM(asked) AS asked, ROUND(SUM(minutes), 1) AS minutes
FROM (SELECT day, COUNT(*) AS cards, SUM(correct = 1) AS correct, SUM(correct IS NOT NULL) AS asked,
             SUM(ms) / 60000.0 AS minutes FROM answer GROUP BY day
      UNION ALL
      SELECT day, 0, 0, 0, SUM(minutes) FROM study GROUP BY day)
GROUP BY day;

CREATE VIEW v_accuracy AS
SELECT a.subject_id, s.title AS subject, COUNT(*) AS asked, SUM(a.correct = 1) AS correct,
       ROUND(100.0 * SUM(a.correct = 1) / COUNT(*), 1) AS pct
FROM answer a LEFT JOIN subject s ON s.id = a.subject_id
WHERE a.correct IS NOT NULL GROUP BY a.subject_id;

-- The cards that trip you up most: wrong answers and lapses.
CREATE VIEW v_hardest AS
SELECT c.id, c.lesson_id, c.text, c.type, c.lesson, c.subject, c.lapses,
       (SELECT COUNT(*) FROM answer a WHERE a.card_id = c.id AND a.correct = 0) AS wrong,
       (SELECT COUNT(*) FROM answer a WHERE a.card_id = c.id AND a.correct IS NOT NULL) AS asked
FROM v_card c
WHERE c.source <> 'mistake' AND ((SELECT COUNT(*) FROM answer a WHERE a.card_id = c.id AND a.correct = 0) > 0 OR c.lapses > 0);

-- Coming back: every card you are struggling with, and when it is next asked.
CREATE VIEW v_struggle AS
SELECT c.id, c.lesson_id, c.text, c.type, c.lesson, c.unit, c.subject_id, c.subject, c.due, c.lapses, c.right_days,
       c.difficulty, c.leech,
       (SELECT MAX(a.at) FROM answer a WHERE a.card_id = c.id AND a.correct = 0) AS last_missed
FROM v_card c WHERE c.struggle = 1;

-- How sure you were, against how often you were right: are "sure" answers really sure?
CREATE VIEW v_confidence AS
SELECT confidence, COUNT(*) AS asked, SUM(correct = 1) AS correct, ROUND(100.0 * SUM(correct = 1) / COUNT(*), 1) AS pct
FROM answer WHERE confidence IS NOT NULL AND correct IS NOT NULL GROUP BY confidence;

-- Your level per subject and unit, with the names to show them by.
CREATE VIEW v_skill AS
SELECT k.scope, k.theta, k.sd, k.n, k.prior, k.placed, k.updated,
       COALESCE(s.title, u.title) AS title, CASE WHEN s.id IS NOT NULL THEN 'subject' ELSE 'unit' END AS kind,
       COALESCE(s.id, u.subject_id) AS subject_id, u.sort AS unit_sort
FROM skill k LEFT JOIN subject s ON s.id = k.scope LEFT JOIN unit u ON u.id = k.scope;
