-- Every derived number. All views are dropped and rebuilt on each start, so a
-- new figure is a CREATE VIEW here, never a migration. Nothing is estimated:
-- each view is sums and joins over what you typed or imported.

-- ------------------------------------------------------------- categories --
-- Any depth. path is 'Vehicle · Car 2 · Fuel'; root is the top-level group.
CREATE VIEW v_category AS
WITH RECURSIVE t(id, parent_id, name, kind, budget, sort, archived,
                 depth, path, root_id, root_name, order_key) AS (
  SELECT id, parent_id, name, kind, budget, sort, archived,
         0, name, id, name, printf('%06d', sort) || '|' || name
  FROM category WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, c.parent_id, c.name, c.kind, c.budget, c.sort, c.archived,
         t.depth + 1, t.path || ' · ' || c.name, t.root_id, t.root_name,
         t.order_key || '/' || printf('%06d', c.sort) || '|' || c.name
  FROM category c JOIN t ON c.parent_id = t.id
  WHERE t.depth < 20
)
SELECT * FROM t;

-- Every category paired with itself and each of its descendants.
CREATE VIEW v_cat_closure AS
WITH RECURSIVE c(ancestor_id, id, depth) AS (
  SELECT id, id, 0 FROM category
  UNION ALL
  SELECT c.ancestor_id, k.id, c.depth + 1
  FROM c JOIN category k ON k.parent_id = c.id WHERE c.depth < 20
)
SELECT ancestor_id, id, depth FROM c;

-- ---------------------------------------------------------------- transactions --
-- A linked pair is money moving between your own accounts, whatever its category.
CREATE VIEW v_txn AS
SELECT t.id, t.date, substr(t.date,1,7) AS month, t.account_id,
       a.name AS account, a.kind AS account_kind, a.share_pct, a.colour AS account_colour,
       t.description, t.description_norm, t.amount, t.note,
       t.statement_id, t.merchant_locked, t.link_id,
       la.name AS linked_account,
       m.id AS merchant_id, m.name AS merchant,
       c.id AS category_id, c.name AS category, t.category_id AS own_category_id,
       CASE WHEN t.link_id IS NOT NULL THEN 'transfer'
            ELSE COALESCE(c.kind, 'unmatched') END AS category_kind,
       c.root_id AS group_id, c.root_name AS category_group,
       COALESCE(c.path, CASE WHEN t.link_id IS NOT NULL THEN 'Transfer' ELSE 'Unsorted' END)
         AS category_path,
       ROUND(t.amount * a.share_pct / 100.0, 2) AS amount_share
FROM txn t
JOIN account a        ON a.id = t.account_id
LEFT JOIN txn lt      ON lt.id = t.link_id
LEFT JOIN account la  ON la.id = lt.account_id
LEFT JOIN merchant m  ON m.id = t.merchant_id
LEFT JOIN v_category c ON c.id = COALESCE(t.category_id, m.category_id);

-- Spending only, as a positive number, at your share. The source for most charts.
CREATE VIEW v_spend AS
SELECT id, date, month, substr(date,1,4) AS year, account_id, account,
       COALESCE(category_group, 'Unsorted') AS grp, category_path AS category,
       category_id, group_id, COALESCE(merchant, description_norm) AS payee,
       ROUND(-amount_share, 2) AS amount
FROM v_txn
WHERE account_kind IN ('current','credit') AND category_kind IN ('spend','unmatched')
  AND amount < 0;

-- Every movement split into in and out, for in-versus-out charts.
CREATE VIEW v_money AS
SELECT id, date, month, account_id, account, category_kind AS kind,
       category_path AS category, COALESCE(category_group, 'Unsorted') AS grp,
       COALESCE(merchant, description_norm) AS payee,
       CASE WHEN amount_share > 0 THEN amount_share ELSE 0 END AS money_in,
       CASE WHEN amount_share < 0 THEN -amount_share ELSE 0 END AS money_out,
       amount_share AS net
FROM v_txn;

-- Payees nobody has sorted yet, biggest first.
CREATE VIEW v_unmatched AS
SELECT description_norm, MIN(description) AS example, COUNT(*) AS n,
       ROUND(SUM(amount),2) AS total, MIN(date) AS first_seen, MAX(date) AS last_seen,
       group_concat(DISTINCT account) AS accounts
FROM v_txn
WHERE merchant_id IS NULL AND category_id IS NULL AND link_id IS NULL
GROUP BY description_norm
ORDER BY ABS(SUM(amount)) DESC;

CREATE VIEW v_rule AS
SELECT r.id, r.kind, r.pattern, r.priority, r.merchant_id, m.name AS payee,
       m.category_id, c.path AS category
FROM match_rule r
JOIN merchant m ON m.id = r.merchant_id
LEFT JOIN v_category c ON c.id = m.category_id;

-- --------------------------------------------------------------- statements --
-- Opening + movements = closing, or the statement is short, doubled or mis-dated.
CREATE VIEW v_statement_check AS
SELECT s.id, s.account_id, a.name AS account, s.filename, s.role,
       s.period_start, s.period_end, s.opening_balance, s.closing_balance,
       s.imported_at, s.row_count, s.note,
       COUNT(t.id) AS rows_found,
       ROUND(COALESCE(SUM(t.amount),0),2) AS movement,
       ROUND(s.closing_balance - (s.opening_balance + COALESCE(SUM(t.amount),0)),2) AS discrepancy,
       CASE WHEN s.closing_balance IS NULL OR s.opening_balance IS NULL THEN 'no balances'
            WHEN ABS(s.closing_balance - (s.opening_balance + COALESCE(SUM(t.amount),0))) < 0.01
              THEN 'balanced'
            ELSE 'off' END AS status
FROM statement s
JOIN account a ON a.id = s.account_id
LEFT JOIN txn t ON t.statement_id = s.id
GROUP BY s.id;

-- Days between one statement and the next. Negative is an overlap.
CREATE VIEW v_coverage_gap AS
SELECT * FROM (
  SELECT account_id,
         DATE(period_end, '+1 day') AS gap_from,
         DATE(LEAD(period_start) OVER w, '-1 day') AS gap_to,
         CAST(julianday(LEAD(period_start) OVER w) - julianday(period_end) - 1 AS INTEGER) AS days
  FROM statement
  WINDOW w AS (PARTITION BY account_id ORDER BY period_start)
) WHERE days IS NOT NULL AND days <> 0;

-- The balance is the closing balance printed on the statement, as you typed it:
-- the current statement if you picked one, otherwise the latest. Nothing added up.
CREATE VIEW v_account_status AS
SELECT a.id, a.name, a.kind, a.archived, a.share_pct, a.last4, a.sort_code, a.sort_order,
       a.colour, a.provider, s.id AS statement_id, s.period_end AS as_of, s.closing_balance AS balance,
       (SELECT v.value FROM valuation v WHERE v.account_id = a.id ORDER BY v.date DESC LIMIT 1)
         AS valuation,
       (SELECT v.date FROM valuation v WHERE v.account_id = a.id ORDER BY v.date DESC LIMIT 1)
         AS valued_on,
       (SELECT COUNT(*) FROM statement x WHERE x.account_id = a.id) AS statements,
       (SELECT MIN(period_start) FROM statement x WHERE x.account_id = a.id) AS since,
       (SELECT COUNT(*) FROM v_coverage_gap g WHERE g.account_id = a.id AND g.days > 0) AS gaps,
       (SELECT COUNT(*) FROM v_statement_check c
         WHERE c.account_id = a.id AND c.status = 'off') AS unreconciled,
       (SELECT COUNT(*) FROM txn t WHERE t.account_id = a.id) AS txns
FROM account a
LEFT JOIN statement s ON s.id = COALESCE(
  (SELECT id FROM statement WHERE account_id = a.id AND role = 'current'),
  (SELECT id FROM statement WHERE account_id = a.id ORDER BY period_end DESC LIMIT 1));

CREATE VIEW v_valuation AS
SELECT v.*, a.name AS account, a.kind,
       EXISTS (SELECT 1 FROM valuation_file f WHERE f.valuation_id = v.id) AS has_file
FROM valuation v JOIN account a ON a.id = v.account_id;

-- -------------------------------------------------------------------- hours --
CREATE VIEW v_shift AS
SELECT s.id, s.date, s.start, s.end, s.project, s.note, s.source,
       CAST(strftime('%w', s.date) AS INTEGER) AS dow,
       date(s.date, '-6 days', 'weekday 1') AS week,
       substr(s.date,1,7) AS month,
       ROUND((julianday(s.date || ' ' || s.end) + (s.end < s.start)
              - julianday(s.date || ' ' || s.start)) * 24, 4) AS hours
FROM shift s;

-- Overtime is per day and never negative, unless Settings says short weekdays
-- count against it (ot_net = 1), which is how the pay sheet adds it up.
-- excess is always the plain difference, short days negative.
CREATE VIEW v_day AS
SELECT s.date, substr(s.date,1,7) AS month, s.week, s.dow, r.name AS day_name,
       COUNT(*) AS shifts,
       ROUND(SUM(s.hours), 2)                          AS hours,
       ROUND(MIN(SUM(s.hours), r.normal_hours), 2)     AS normal_hours,
       ROUND(SUM(s.hours) - r.normal_hours, 2)         AS excess,
       ROUND(CASE WHEN r.normal_hours > 0
                   AND (SELECT value FROM setting WHERE key = 'ot_net') = '1'
                  THEN SUM(s.hours) - r.normal_hours
                  ELSE MAX(0, SUM(s.hours) - r.normal_hours) END, 2) AS ot_hours,
       r.ot_mult,
       ROUND(MIN(SUM(s.hours), r.normal_hours)
             + (CASE WHEN r.normal_hours > 0
                      AND (SELECT value FROM setting WHERE key = 'ot_net') = '1'
                     THEN SUM(s.hours) - r.normal_hours
                     ELSE MAX(0, SUM(s.hours) - r.normal_hours) END) * r.ot_mult, 2) AS paid_hours,
       (SELECT name FROM bank_holiday b WHERE b.date = s.date) AS bank_holiday
FROM v_shift s JOIN day_rule r ON r.dow = s.dow
GROUP BY s.date;

CREATE VIEW v_day_paid AS
SELECT d.*, p.annual,
       COALESCE(p.ot_hourly, p.annual / (52.0 *
         (SELECT CAST(value AS REAL) FROM setting WHERE key='weekly_contract_hours'))) AS hourly,
       ROUND(d.ot_hours * d.ot_mult * COALESCE(p.ot_hourly, p.annual / (52.0 *
         (SELECT CAST(value AS REAL) FROM setting WHERE key='weekly_contract_hours'))), 2) AS ot_pay
FROM v_day d
LEFT JOIN pay_rate p ON p.from_date =
  (SELECT MAX(from_date) FROM pay_rate WHERE from_date <= d.date);

CREATE VIEW v_week AS
SELECT week, MIN(date) AS from_date, MAX(date) AS to_date,
       ROUND(SUM(hours),2) AS hours, ROUND(SUM(normal_hours),2) AS normal_hours,
       ROUND(SUM(ot_hours),2) AS ot_hours, ROUND(SUM(paid_hours),2) AS paid_hours
FROM v_day GROUP BY week;

CREATE VIEW v_hours_period AS
SELECT 'week' AS grain, week AS period, MIN(date) AS from_date, MAX(date) AS to_date,
       COUNT(*) AS days, ROUND(SUM(hours),2) AS hours, ROUND(SUM(normal_hours),2) AS normal_hours,
       ROUND(SUM(ot_hours),2) AS ot_hours, ROUND(SUM(paid_hours),2) AS paid_hours
FROM v_day GROUP BY 2
UNION ALL
SELECT 'month', substr(date,1,7), MIN(date), MAX(date), COUNT(*), ROUND(SUM(hours),2),
       ROUND(SUM(normal_hours),2), ROUND(SUM(ot_hours),2), ROUND(SUM(paid_hours),2)
FROM v_day GROUP BY 2
UNION ALL
SELECT 'bimonth', substr(date,1,4) || '-B' || ((CAST(substr(date,6,2) AS INTEGER) + 1) / 2),
       MIN(date), MAX(date), COUNT(*), ROUND(SUM(hours),2),
       ROUND(SUM(normal_hours),2), ROUND(SUM(ot_hours),2), ROUND(SUM(paid_hours),2)
FROM v_day GROUP BY 2
UNION ALL
SELECT 'quarter', substr(date,1,4) || '-Q' || ((CAST(substr(date,6,2) AS INTEGER) + 2) / 3),
       MIN(date), MAX(date), COUNT(*), ROUND(SUM(hours),2),
       ROUND(SUM(normal_hours),2), ROUND(SUM(ot_hours),2), ROUND(SUM(paid_hours),2)
FROM v_day GROUP BY 2
UNION ALL
SELECT 'year', substr(date,1,4), MIN(date), MAX(date), COUNT(*), ROUND(SUM(hours),2),
       ROUND(SUM(normal_hours),2), ROUND(SUM(ot_hours),2), ROUND(SUM(paid_hours),2)
FROM v_day GROUP BY 2
UNION ALL
SELECT 'taxyear', CAST(CAST(substr(date,1,4) AS INTEGER) - (substr(date,6,5) < '04-06') AS TEXT),
       MIN(date), MAX(date), COUNT(*), ROUND(SUM(hours),2),
       ROUND(SUM(normal_hours),2), ROUND(SUM(ot_hours),2), ROUND(SUM(paid_hours),2)
FROM v_day GROUP BY 2;

-- ---------------------------------------------------------------------- pay --
-- Gross is the Payments lines, net is gross less the Deductions lines.
CREATE VIEW v_payslip AS
SELECT p.pay_date, p.worked_month, p.tax_code, p.ni_letter, p.note,
       substr(p.pay_date,1,7) AS month,
       CAST(substr(p.pay_date,1,4) AS INTEGER) - (substr(p.pay_date,6,5) < '04-06') AS tax_year,
       ROUND(COALESCE(SUM(CASE WHEN l.grp='pay' THEN l.amount END),0),2) AS gross,
       ROUND(COALESCE(SUM(CASE WHEN l.grp='deduction' THEN l.amount END),0),2) AS deductions,
       ROUND(COALESCE(SUM(CASE WHEN l.grp='pay' THEN l.amount END),0)
           - COALESCE(SUM(CASE WHEN l.grp='deduction' THEN l.amount END),0),2) AS net,
       ROUND(COALESCE(SUM(CASE WHEN l.grp='employer' THEN l.amount END),0),2) AS employer,
       ROUND(COALESCE(SUM(CASE WHEN l.code='basic' THEN l.amount END),0),2) AS basic,
       ROUND(COALESCE(SUM(CASE WHEN l.code IN ('ot15','ot2') THEN l.amount END),0),2) AS overtime_pay,
       ROUND(COALESCE(SUM(CASE WHEN l.code='ot15' THEN l.amount END),0),2) AS ot15_pay,
       ROUND(COALESCE(SUM(CASE WHEN l.code='ot2' THEN l.amount END),0),2) AS ot2_pay,
       SUM(CASE WHEN l.code IN ('ot15','ot2') THEN l.qty END) AS overtime_hours,
       SUM(CASE WHEN l.code='ot15' THEN l.qty END) AS ot15_hours,
       SUM(CASE WHEN l.code='ot2' THEN l.qty END) AS ot2_hours,
       ROUND(COALESCE(SUM(CASE WHEN l.code='tax' THEN l.amount END),0),2) AS tax,
       ROUND(COALESCE(SUM(CASE WHEN l.code='ni' THEN l.amount END),0),2) AS ni,
       ROUND(COALESCE(SUM(CASE WHEN l.code='pension' THEN l.amount END),0),2) AS pension,
       ROUND(COALESCE(SUM(CASE WHEN l.code='student_loan' THEN l.amount END),0),2) AS student_loan,
       ROUND(COALESCE(SUM(CASE WHEN l.code='er_ni' THEN l.amount END),0),2) AS er_ni,
       ROUND(COALESCE(SUM(CASE WHEN l.code='er_pension' THEN l.amount END),0),2) AS er_pension,
       COUNT(l.id) AS lines
FROM payslip p LEFT JOIN payslip_line l ON l.pay_date = p.pay_date
GROUP BY p.pay_date;

-- ------------------------------------------------------------------- months --
CREATE VIEW v_month_list AS
SELECT DISTINCT substr(date,1,7) AS month FROM txn
UNION SELECT DISTINCT substr(date,1,7) FROM shift
UNION SELECT DISTINCT substr(pay_date,1,7) FROM payslip
UNION SELECT DISTINCT worked_month FROM payslip WHERE worked_month IS NOT NULL;

CREATE VIEW v_month_cash AS
SELECT m.month,
  ROUND(COALESCE((SELECT SUM(amount_share) FROM v_txn v
                   WHERE v.month = m.month AND v.account_kind IN ('current','credit')
                     AND v.category_kind = 'income'),0),2) AS income,
  ROUND(COALESCE((SELECT SUM(amount) FROM v_spend s WHERE s.month = m.month),0),2) AS spend,
  ROUND(COALESCE((SELECT SUM(amount) FROM v_txn v
                   WHERE v.month = m.month AND v.account_kind IN ('savings','investment','pension')
                     AND v.category_kind = 'transfer' AND v.amount > 0),0),2) AS saved,
  ROUND(COALESCE((SELECT SUM(amount_share) FROM v_txn v
                   WHERE v.month = m.month AND v.category_kind = 'interest'),0),2) AS interest,
  COALESCE((SELECT COUNT(*) FROM v_txn v
             WHERE v.month = m.month AND v.category_kind = 'unmatched'),0) AS unsorted
FROM v_month_list m;

CREATE VIEW v_month_hours AS
SELECT m.month,
  ROUND(COALESCE((SELECT SUM(hours) FROM v_day d WHERE d.month = m.month),0),2) AS hours,
  ROUND(COALESCE((SELECT SUM(normal_hours) FROM v_day d WHERE d.month = m.month),0),2) AS normal_hours,
  ROUND(COALESCE((SELECT SUM(ot_hours) FROM v_day d WHERE d.month = m.month),0),2) AS ot_hours,
  ROUND(COALESCE((SELECT SUM(ot_hours) FROM v_day d
                   WHERE d.month = m.month AND d.ot_mult < 2),0),2) AS ot15_hours,
  ROUND(COALESCE((SELECT SUM(ot_hours) FROM v_day d
                   WHERE d.month = m.month AND d.ot_mult >= 2),0),2) AS ot2_hours,
  ROUND(COALESCE((SELECT SUM(paid_hours) FROM v_day d WHERE d.month = m.month),0),2) AS paid_hours,
  ROUND(COALESCE((SELECT SUM(ot_pay) FROM v_day_paid d WHERE d.month = m.month),0),2) AS ot_pay,
  COALESCE((SELECT COUNT(*) FROM v_day d WHERE d.month = m.month),0) AS days_worked
FROM v_month_list m;

-- A calendar month: money that moved in it, hours worked in it, the payslip paid in it.
CREATE VIEW v_month AS
SELECT c.month, c.income, c.spend, c.saved, c.interest, c.unsorted,
       h.hours, h.ot_hours, h.paid_hours, h.ot_pay, h.days_worked,
       p.gross, p.net, p.tax, p.ni, p.pension, p.student_loan, p.er_ni, p.er_pension,
       ROUND(c.income - c.spend, 2) AS left_over
FROM v_month_cash c
JOIN v_month_hours h USING (month)
LEFT JOIN v_payslip p ON p.month = c.month;

-- A pay period: the month worked, and the payslip that paid for it.
CREATE VIEW v_pay_period AS
SELECT h.month, h.hours, h.normal_hours, h.ot_hours, h.ot15_hours, h.ot2_hours,
       h.paid_hours, h.ot_pay, h.days_worked,
       p.pay_date, p.gross, p.net, p.tax, p.ni, p.overtime_pay
FROM v_month_hours h
LEFT JOIN v_payslip p ON p.worked_month = h.month;

CREATE VIEW v_year AS
SELECT substr(month,1,4) AS year,
       ROUND(SUM(income),2) AS income, ROUND(SUM(spend),2) AS spend,
       ROUND(SUM(saved),2) AS saved, ROUND(SUM(left_over),2) AS left_over,
       ROUND(SUM(hours),2) AS hours, ROUND(SUM(ot_hours),2) AS ot_hours,
       ROUND(SUM(gross),2) AS gross, ROUND(SUM(net),2) AS net
FROM v_month GROUP BY 1;

-- Tax year = the April it starts in. 2026 = 6 Apr 2026 .. 5 Apr 2027.
CREATE VIEW v_tax_year AS
SELECT tax_year, COUNT(*) AS payslips,
       ROUND(SUM(gross),2) AS gross, ROUND(SUM(net),2) AS net, ROUND(SUM(tax),2) AS tax,
       ROUND(SUM(ni),2) AS ni, ROUND(SUM(pension),2) AS pension,
       ROUND(SUM(student_loan),2) AS student_loan, ROUND(SUM(overtime_pay),2) AS overtime_pay,
       ROUND(SUM(er_ni),2) AS er_ni, ROUND(SUM(er_pension),2) AS er_pension
FROM v_payslip GROUP BY tax_year;

-- The P60 log: a row for every tax year with payslips or a P60, the P60 as typed
-- beside what the payslips add up to. A difference is worth asking payroll about.
CREATE VIEW v_p60 AS
WITH years AS (SELECT tax_year FROM p60 UNION SELECT tax_year FROM v_tax_year)
SELECT y.tax_year, p.pay, p.tax, p.ni, p.student_loan, p.tax_code, p.note,
       p.tax_year IS NOT NULL AS has_p60, COALESCE(t.payslips, 0) AS payslips,
       t.gross AS slips_gross, t.tax AS slips_tax, t.ni AS slips_ni, t.student_loan AS slips_student_loan,
       ROUND(p.tax - COALESCE(t.tax, 0), 2) AS tax_diff, ROUND(p.ni - COALESCE(t.ni, 0), 2) AS ni_diff,
       ROUND(p.student_loan - COALESCE(t.student_loan, 0), 2) AS student_loan_diff
FROM years y LEFT JOIN p60 p ON p.tax_year = y.tax_year LEFT JOIN v_tax_year t ON t.tax_year = y.tax_year;

-- ----------------------------------------------------------------- holidays --
-- A leave year: the allowance, extra days, and time off in lieu earned (hours, made into days).
-- Annual leave and time off in lieu booked both come off what is left.
CREATE VIEW v_leave_year AS
SELECT *, ROUND(allowance + extra + toil_days, 2) AS total,
       ROUND(allowance + extra + toil_days - taken - extra_taken, 2) AS remaining,
       ROUND(toil_hours - extra_taken * day_hours, 2) AS toil_left
FROM (
  SELECT y.year, y.allowance, y.extra, y.note, y.toil_hours, d.h AS day_hours,
         ROUND(y.toil_hours / d.h, 2) AS toil_days,
         ROUND(COALESCE((SELECT SUM(l.days) FROM leave l WHERE l.kind = 'holiday'
                          AND substr(l.from_date,1,4) = CAST(y.year AS TEXT)),0),2) AS taken,
         ROUND(COALESCE((SELECT SUM(l.days) FROM leave l WHERE l.kind = 'extra'
                          AND substr(l.from_date,1,4) = CAST(y.year AS TEXT)),0),2) AS extra_taken,
         (SELECT COUNT(*) FROM bank_holiday b
           WHERE substr(b.date,1,4) = CAST(y.year AS TEXT)) AS bank_holidays
  FROM leave_year y,
       (SELECT COALESCE(NULLIF(CAST(NULLIF((SELECT value FROM setting WHERE key = 'leave_day_hours'), '') AS REAL), 0),
                        NULLIF(CAST((SELECT value FROM setting WHERE key = 'weekly_contract_hours') AS REAL) / 5.0, 0), 7.5) AS h) d
);

-- ----------------------------------------------------------- category totals --
CREATE VIEW v_cat_tree AS
SELECT c.*,
       (SELECT COUNT(*) FROM category k WHERE k.parent_id = c.id) AS children,
       (SELECT COUNT(*) FROM merchant m WHERE m.category_id = c.id) AS payees,
       (SELECT COUNT(*) FROM txn t LEFT JOIN merchant m ON m.id = t.merchant_id
         WHERE COALESCE(t.category_id, m.category_id) = c.id) AS txns
FROM v_category c;

CREATE VIEW v_cat_actual AS
SELECT month, group_id, grp AS group_name, category_id, category AS category_path,
       ROUND(SUM(amount),2) AS actual
FROM v_spend GROUP BY month, category_id;

-- A budget covers the category and everything under it.
CREATE VIEW v_budget AS
SELECT m.month, c.id AS category_id, c.path, c.budget,
       ROUND(COALESCE((SELECT SUM(s.amount) FROM v_spend s
                        JOIN v_cat_closure k ON k.id = s.category_id
                       WHERE k.ancestor_id = c.id AND s.month = m.month),0),2) AS actual,
       ROUND(COALESCE((SELECT SUM(s.amount) FROM v_spend s
                        JOIN v_cat_closure k ON k.id = s.category_id
                       WHERE k.ancestor_id = c.id AND s.month = m.month),0) - c.budget,2) AS variance
FROM v_category c CROSS JOIN v_month_list m
WHERE c.budget IS NOT NULL;

-- -------------------------------------------------------------------- tags --
CREATE VIEW v_tag_spend AS
SELECT g.id AS tag_id, g.name AS tag, g.kind AS tag_kind, s.*
FROM tag g
JOIN txn_tag x ON x.tag_id = g.id
JOIN v_spend s ON s.id = x.txn_id;

CREATE VIEW v_tag_total AS
SELECT g.id AS tag_id, g.name AS tag, g.kind, g.closed,
       COUNT(t.id) AS n, ROUND(SUM(-t.amount_share),2) AS total,
       MIN(t.date) AS first_seen, MAX(t.date) AS last_seen
FROM tag g
LEFT JOIN txn_tag x ON x.tag_id = g.id
LEFT JOIN v_txn t   ON t.id = x.txn_id AND t.amount < 0
GROUP BY g.id;

CREATE VIEW v_merchant_total AS
SELECT m.id, m.name, m.category_id, c.path AS category, m.default_tag, m.note,
       COUNT(t.id) AS n, ROUND(SUM(-t.amount_share),2) AS total, MAX(t.date) AS last_seen,
       (SELECT COUNT(*) FROM match_rule r WHERE r.merchant_id = m.id) AS rules
FROM merchant m
LEFT JOIN v_category c ON c.id = m.category_id
LEFT JOIN v_txn t ON t.merchant_id = m.id
GROUP BY m.id;

-- --------------------------------------------------------------- shapes --
CREATE VIEW v_daily_cum AS
SELECT month, CAST(substr(date,9,2) AS INTEGER) AS dom,
       ROUND(SUM(SUM(amount)) OVER (PARTITION BY month ORDER BY date),2) AS cum
FROM v_spend GROUP BY month, date;

CREATE VIEW v_weekday AS
SELECT CAST(strftime('%w', date) AS INTEGER) AS dow,
       CASE CAST(strftime('%w', date) AS INTEGER)
         WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed'
         WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' ELSE 'Sat' END AS day_name,
       date, month, amount
FROM v_spend;

CREATE VIEW v_biggest AS
SELECT date, month, account, payee, category, amount FROM v_spend ORDER BY amount DESC;

-- --------------------------------------------------------- lending and debts --
CREATE VIEW v_owed AS
SELECT COALESCE(g.name, '(no person tag)') AS person, g.id AS tag_id,
       ROUND(SUM(CASE WHEN t.category_kind = 'lending'   THEN -t.amount ELSE 0 END), 2) AS lent,
       ROUND(SUM(CASE WHEN t.category_kind = 'borrowing' THEN  t.amount ELSE 0 END), 2) AS borrowed,
       ROUND(SUM(-t.amount), 2) AS net,
       COUNT(*) AS movements, MAX(t.date) AS last_movement
FROM v_txn t
LEFT JOIN txn_tag x ON x.txn_id = t.id
LEFT JOIN tag g     ON g.id = x.tag_id
WHERE t.category_kind IN ('lending', 'borrowing')
GROUP BY g.id;

-- ------------------------------------------------------------------ pension --
-- Money into a pension: your and your employer's contributions from each payslip (to the
-- pension that payslip names, or the usual one), money paid in or out on a statement, and
-- contributions typed in. origin and ref say where a row came from, so it can be opened.
CREATE VIEW v_pension_flow AS
SELECT *, CAST(substr(date,1,4) AS INTEGER) - (substr(date,6,5) < '04-06') AS tax_year FROM (
  SELECT COALESCE(p.pension_account_id,
           (SELECT a.id FROM account a WHERE a.id =
               CAST(NULLIF((SELECT value FROM setting WHERE key = 'pension_account'), '') AS INTEGER)),
           (SELECT id FROM account WHERE kind = 'pension' AND archived = 0 ORDER BY sort_order, id LIMIT 1))
           AS account_id,
         l.pay_date AS date, substr(l.pay_date,1,7) AS month,
         CASE l.code WHEN 'pension' THEN 'you' ELSE 'employer' END AS source,
         l.amount, l.label AS note, 'payslip' AS origin, l.pay_date AS ref
  FROM payslip_line l JOIN payslip p ON p.pay_date = l.pay_date WHERE l.code IN ('pension', 'er_pension')
  UNION ALL
  SELECT t.account_id, t.date, substr(t.date,1,7),
         CASE WHEN t.amount >= 0 THEN 'paid in' ELSE 'taken out' END, t.amount, t.description, 'statement', t.id
  FROM txn t JOIN account a ON a.id = t.account_id WHERE a.kind = 'pension'
  UNION ALL
  SELECT c.account_id, c.date, substr(c.date,1,7),
         CASE WHEN c.amount >= 0 THEN 'paid in' ELSE 'taken out' END, c.amount, c.note, 'typed', c.id
  FROM contribution c JOIN account a ON a.id = c.account_id WHERE a.kind = 'pension'
) WHERE account_id IS NOT NULL;

-- Everything put away: savings, investments and pensions, one row each. The value is the
-- newest figure there is, a valuation or a statement's closing balance. Paid in is the
-- opening figure plus money in and out (statements, typed, payslips for pensions); blank
-- when nothing has been recorded, so growth is not the whole value. Growth needs a valuation:
-- a statement balance is only what went in and out, so it has none to show.
CREATE VIEW v_holding AS
SELECT *, CASE WHEN paid_in IS NULL OR value IS NULL OR basis = 'statement' THEN NULL ELSE ROUND(value - paid_in, 2) END AS gain,
       ROUND(value * share_pct / 100.0, 2) AS value_share
FROM (
  SELECT a.id, a.name, a.kind, a.provider, a.colour, a.share_pct, a.sort_order, a.opening,
         CASE a.kind WHEN 'savings' THEN 'Savings' WHEN 'investment' THEN 'Investments' ELSE 'Pensions' END AS grp,
         CASE a.kind WHEN 'savings' THEN 1 WHEN 'investment' THEN 2 ELSE 3 END AS grp_sort,
         CASE WHEN st.valued_on IS NOT NULL AND (st.as_of IS NULL OR st.valued_on >= st.as_of) THEN st.valuation ELSE st.balance END AS value,
         CASE WHEN st.valued_on IS NOT NULL AND (st.as_of IS NULL OR st.valued_on >= st.as_of) THEN st.valued_on ELSE st.as_of END AS as_of,
         CASE WHEN st.valued_on IS NOT NULL AND (st.as_of IS NULL OR st.valued_on >= st.as_of) THEN 'valuation'
              WHEN st.as_of IS NOT NULL THEN 'statement' END AS basis,
         (SELECT COUNT(*) FROM valuation v WHERE v.account_id = a.id) AS valuations,
         CASE WHEN a.kind = 'pension' THEN
                CASE WHEN a.opening <> 0 OR EXISTS (SELECT 1 FROM v_pension_flow f WHERE f.account_id = a.id)
                     THEN ROUND(a.opening + COALESCE((SELECT SUM(amount) FROM v_pension_flow f WHERE f.account_id = a.id), 0), 2) END
              ELSE
                CASE WHEN a.opening <> 0 OR EXISTS (SELECT 1 FROM txn t WHERE t.account_id = a.id)
                          OR EXISTS (SELECT 1 FROM contribution c WHERE c.account_id = a.id)
                     THEN ROUND(a.opening + COALESCE((SELECT SUM(amount) FROM txn t WHERE t.account_id = a.id), 0)
                                          + COALESCE((SELECT SUM(amount) FROM contribution c WHERE c.account_id = a.id), 0), 2) END
         END AS paid_in
  FROM account a JOIN v_account_status st ON st.id = a.id
  WHERE a.kind IN ('savings', 'investment', 'pension') AND a.archived = 0
);

-- Money in and out of savings and investments, every source (pensions have v_pension_flow).
CREATE VIEW v_contribution AS
SELECT c.id, c.account_id, a.name AS account, a.kind, c.date, c.amount, c.note, 'typed' AS origin, c.id AS ref
FROM contribution c JOIN account a ON a.id = c.account_id
UNION ALL
SELECT NULL, t.account_id, a.name, a.kind, t.date, t.amount, t.description, 'statement', t.id
FROM txn t JOIN account a ON a.id = t.account_id WHERE a.kind IN ('savings', 'investment')
UNION ALL
SELECT NULL, f.account_id, a.name, a.kind, f.date, f.amount, f.note, f.origin, f.ref
FROM v_pension_flow f JOIN account a ON a.id = f.account_id WHERE f.origin <> 'typed';

-- The investment accounts, as before (kept for panels built on it).
CREATE VIEW v_invest AS
SELECT id, name, value, as_of AS valued_on, paid_in AS deposited, gain FROM v_holding WHERE kind = 'investment';

CREATE VIEW v_pension AS
SELECT h.id, h.name, h.provider, h.colour, h.opening,
       ROUND(COALESCE((SELECT SUM(amount) FROM v_pension_flow f WHERE f.account_id = h.id AND f.source = 'you'),0),2) AS from_you,
       ROUND(COALESCE((SELECT SUM(amount) FROM v_pension_flow f WHERE f.account_id = h.id AND f.source = 'employer'),0),2) AS from_employer,
       ROUND(COALESCE((SELECT SUM(amount) FROM v_pension_flow f WHERE f.account_id = h.id AND f.source IN ('paid in','taken out')),0),2) AS other,
       COALESCE(h.paid_in, 0) AS paid_in, h.value, h.as_of AS valued_on, h.gain
FROM v_holding h WHERE h.kind = 'pension';

-- ---------------------------------------------------------------- receipts --
-- Without the picture itself: that loads when a receipt is opened.
CREATE VIEW v_receipt AS
SELECT r.id, r.txn_id, COALESCE(r.date, t.date) AS date, COALESCE(r.amount, ABS(t.amount)) AS amount, r.note, r.thumb,
       r.image LIKE 'data:application/pdf%' AS pdf, r.created, t.description
FROM receipt r LEFT JOIN txn t ON t.id = r.txn_id;
