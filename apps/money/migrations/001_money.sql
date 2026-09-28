-- Money: hours, pay, holidays, spending, accounts, investments and bills.
-- One file per database, rollback journal (never WAL: a yanked stick and a
-- sidecar file do not mix). Every derived number is a view in views.sql.

-- ---------------------------------------------------------------- settings ----
INSERT INTO setting (key, value) VALUES
  ('payday',                   '17'),       -- hours worked in a month are paid on this day of the next
  ('weekly_contract_hours',    '39'),       -- £26,000 a year is £12.82 an hour
  ('ot_net',                   '0'),        -- 1: short weekdays reduce overtime, as the old pay sheet did
  ('pension_pct',              '5'),
  ('pension_relief',           'net_pay'),  -- net_pay | sacrifice | relief_at_source
  ('employer_pension_pct',     '3'),
  ('pension_annual_allowance', '60000'),    -- 2026/27 figure; check each April
  ('pension_account',          ''),         -- which pension the payslip pays into ('' = the first)
  ('student_loan_plan',        'plan2'),
  ('works_number',             ''), ('ni_number', ''), ('ni_table', 'A'),
  ('tax_code',                 '1257L'), ('employer_paye_ref', ''),
  ('toil_earned',              '0'), ('toil_used', '0'),
  ('safe_account',             ''),         -- the current account safe-to-spend reads ('' = the first)
  ('safe_savings',             '0'),        -- kept back each pay month before anything counts as safe to spend
  ('safe_balance',             ''),         -- a balance typed today, used when newer than the statement's
  ('safe_balance_on',          '');

-- ---------------------------------------------------------------- accounts ----
CREATE TABLE account (
  id         INTEGER PRIMARY KEY,
  name       TEXT UNIQUE NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('current','savings','investment','credit','pension')),
  last4      TEXT,                              -- matches a statement to an account
  sort_code  TEXT,
  opening    REAL NOT NULL DEFAULT 0,           -- before the earliest statement held
  share_pct  REAL NOT NULL DEFAULT 100,         -- a joint account counts at a fixed share
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  colour     TEXT,
  provider   TEXT
);

-- A statement is a document the bank sent. One per account is 'current' and
-- defines the present; the rest are history. Its closing balance, as typed,
-- is the account's balance: never a sum the app works out.
CREATE TABLE statement (
  id              INTEGER PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES account(id),
  filename        TEXT NOT NULL,
  imported_at     TEXT NOT NULL DEFAULT (datetime('now')),
  period_start    TEXT NOT NULL CHECK (period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_end      TEXT NOT NULL CHECK (period_end   GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  opening_balance REAL,
  closing_balance REAL,
  row_count       INTEGER NOT NULL DEFAULT 0,
  content_hash    TEXT UNIQUE,      -- the same file twice is refused, not duplicated
  role            TEXT NOT NULL DEFAULT 'history' CHECK (role IN ('current','history')),
  note            TEXT,
  CHECK (period_end >= period_start)
);
CREATE UNIQUE INDEX ux_statement_current ON statement(account_id) WHERE role = 'current';
CREATE INDEX ix_statement_account ON statement(account_id, period_start);

-- A bank's CSV layout, learned once and recognised by its header row afterwards.
CREATE TABLE format_profile (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  header_hash  TEXT UNIQUE NOT NULL,
  mapping      TEXT NOT NULL,          -- JSON: column roles
  date_style   TEXT NOT NULL DEFAULT 'dmy'  CHECK (date_style IN ('dmy','mdy','iso')),
  amount_style TEXT NOT NULL DEFAULT 'signed'
               CHECK (amount_style IN ('signed','inout','signed_flipped')),
  account_id   INTEGER REFERENCES account(id),
  used_count   INTEGER NOT NULL DEFAULT 0
);

-- Recorded as the market says, not as deposits add up; net worth uses the
-- latest valuation on or before a date.
CREATE TABLE valuation (
  id         INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  date       TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  value      REAL NOT NULL,
  note       TEXT,
  UNIQUE (account_id, date)
);

-- ------------------------------------------------------ categories and payees ----
-- Categories behave by KIND, not by the name you give them: calling wages
-- "Salary" must not turn them into negative spending.
CREATE TABLE category (
  id        INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES category(id) ON DELETE CASCADE,   -- NULL = a group
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL DEFAULT 'spend'
            CHECK (kind IN ('spend','income','transfer','interest','saving','lending','borrowing')),
  budget    REAL,                       -- monthly target, allowed at either level
  sort      INTEGER NOT NULL DEFAULT 0,
  archived  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (parent_id, name)
);

CREATE TABLE tag (
  id     INTEGER PRIMARY KEY,
  name   TEXT UNIQUE NOT NULL,
  kind   TEXT NOT NULL DEFAULT 'thing' CHECK (kind IN ('vehicle','person','trip','job','project','thing')),
  colour TEXT,
  closed INTEGER NOT NULL DEFAULT 0,
  note   TEXT
);

-- One payee, however the bank spells it. The payee carries the category, so
-- setting it once fixes every past and future transaction from that payee.
CREATE TABLE merchant (
  id          INTEGER PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  category_id INTEGER REFERENCES category(id) ON DELETE SET NULL,
  default_tag INTEGER REFERENCES tag(id) ON DELETE SET NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,   -- your own accounts: a transfer, not a payee
  note        TEXT
);

CREATE TABLE match_rule (
  id          INTEGER PRIMARY KEY,
  merchant_id INTEGER NOT NULL REFERENCES merchant(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('exact','prefix','contains','regex')),
  pattern     TEXT NOT NULL,
  priority    INTEGER NOT NULL DEFAULT 100,   -- lower wins; exact rules sit at 10
  UNIQUE (kind, pattern)
);

-- ------------------------------------------------------------ transactions ----
CREATE TABLE txn (
  id               INTEGER PRIMARY KEY,
  account_id       INTEGER NOT NULL REFERENCES account(id),
  statement_id     INTEGER REFERENCES statement(id),
  date             TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  description      TEXT NOT NULL,
  -- the description with the bank's noise stripped (card suffixes, dates,
  -- references): matching and grouping use this, never the raw text
  description_norm TEXT,
  amount           REAL NOT NULL,        -- + money in, - money out
  merchant_id      INTEGER REFERENCES merchant(id) ON DELETE SET NULL,
  merchant_locked  INTEGER NOT NULL DEFAULT 0,   -- set by hand: a rescan never overwrites it
  category_id      INTEGER REFERENCES category(id) ON DELETE SET NULL,
  -- moving money between your own accounts: the two rows point at each other
  link_id          INTEGER REFERENCES txn(id) ON DELETE SET NULL,
  note             TEXT
);
CREATE INDEX ix_txn_date      ON txn(date);
CREATE INDEX ix_txn_account   ON txn(account_id, date);
CREATE INDEX ix_txn_statement ON txn(statement_id);
CREATE INDEX ix_txn_norm      ON txn(description_norm);
CREATE INDEX ix_txn_merchant  ON txn(merchant_id);
CREATE INDEX ix_txn_link      ON txn(link_id);

CREATE TABLE txn_tag (
  txn_id INTEGER NOT NULL REFERENCES txn(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (txn_id, tag_id)
);
CREATE INDEX ix_txn_tag_tag ON txn_tag(tag_id);

-- A photo or PDF of a receipt. Photos are shrunk to JPEG in the browser; a PDF
-- is kept as it came. A receipt can wait for its transaction (date and amount
-- are there to find it) and is deleted with it.
CREATE TABLE receipt (
  id      INTEGER PRIMARY KEY,
  txn_id  INTEGER REFERENCES txn(id) ON DELETE CASCADE,
  image   TEXT NOT NULL CHECK (image GLOB 'data:image/jpeg;base64,*' OR image GLOB 'data:application/pdf;base64,*')
                        CHECK (LENGTH(image) <= 14000000),          -- a 10 MB PDF, in base64
  thumb   TEXT CHECK (thumb IS NULL OR thumb GLOB 'data:image/jpeg;base64,*'),
  date    TEXT CHECK (date IS NULL OR date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount  REAL,
  note    TEXT,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M', 'now', 'localtime'))
);
CREATE INDEX ix_receipt_txn ON receipt(txn_id);

-- ------------------------------------------------------------------- hours ----
-- Overtime rules, one row per weekday. Data, not code.
CREATE TABLE day_rule (
  dow          INTEGER PRIMARY KEY,   -- 0=Sun .. 6=Sat, matches strftime('%w')
  name         TEXT NOT NULL,
  normal_hours REAL NOT NULL,
  ot_mult      REAL NOT NULL
);
INSERT INTO day_rule VALUES
  (0,'Sunday',0,2.0),(1,'Monday',8.5,1.5),(2,'Tuesday',8.5,1.5),(3,'Wednesday',8.5,1.5),
  (4,'Thursday',8.5,1.5),(5,'Friday',7.5,1.5),(6,'Saturday',0,2.0);

-- A split day is two shifts. Breaks are not recorded.
CREATE TABLE shift (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL CHECK (date  GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start       TEXT NOT NULL CHECK (start GLOB '[0-2][0-9]:[0-5][0-9]'),
  end         TEXT NOT NULL CHECK (end   GLOB '[0-2][0-9]:[0-5][0-9]'),
  project     TEXT,
  note        TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',   -- manual | clockify | spreadsheet
  external_id TEXT                              -- Clockify's id: a re-import updates, not doubles
);
CREATE INDEX ix_shift_date ON shift(date);
CREATE UNIQUE INDEX ux_shift_external ON shift(external_id) WHERE external_id IS NOT NULL;

CREATE TABLE pay_rate (
  from_date TEXT PRIMARY KEY CHECK (from_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  annual    REAL NOT NULL,
  ot_hourly REAL,                 -- NULL = annual / (52 * weekly_contract_hours)
  note      TEXT
);

-- --------------------------------------------------------------------- pay ----
-- Payslips as lines in groups, the way the payslip itself is laid out. Gross,
-- deductions and net are sums of the lines (v_payslip), never typed twice.
CREATE TABLE payslip (
  pay_date     TEXT PRIMARY KEY CHECK (pay_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  worked_month TEXT CHECK (worked_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  tax_code     TEXT,
  ni_letter    TEXT,
  note         TEXT
);
CREATE TABLE payslip_line (
  id       INTEGER PRIMARY KEY,
  pay_date TEXT NOT NULL REFERENCES payslip(pay_date) ON DELETE CASCADE ON UPDATE CASCADE,
  grp      TEXT NOT NULL CHECK (grp IN ('pay','deduction','employer','ytd')),
  label    TEXT NOT NULL,
  qty      REAL,
  rate     REAL,
  amount   REAL NOT NULL DEFAULT 0,
  code     TEXT,          -- basic ot15 ot2 bonus tax ni pension student_loan er_ni er_pension
  sort     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_payslip_line ON payslip_line(pay_date, grp, sort);

-- The figures off each P60, typed in, to check the payslips against.
CREATE TABLE p60 (
  tax_year     INTEGER PRIMARY KEY,
  pay          REAL,
  tax          REAL,
  ni           REAL,
  student_loan REAL,
  tax_code     TEXT,
  note         TEXT
);

-- ponytail: 2025/26 and 2026/27 UK figures as known at build time. They move
-- every April: check gov.uk and edit them under Settings → Tax figures.
CREATE TABLE tax_year_cfg (
  tax_year           INTEGER PRIMARY KEY,
  personal_allowance REAL NOT NULL,
  pa_taper_start     REAL NOT NULL,
  pa_taper_rate      REAL NOT NULL
);
INSERT INTO tax_year_cfg VALUES (2025,12570,100000,0.5),(2026,12570,100000,0.5);

CREATE TABLE rate_band (
  tax_year INTEGER NOT NULL,
  kind     TEXT NOT NULL,       -- income|ni_ee|ni_er|plan1|plan2|plan4|plan5|pgl
  lower    REAL NOT NULL,
  upper    REAL NOT NULL,
  rate     REAL NOT NULL,
  PRIMARY KEY (tax_year, kind, lower)
);
INSERT INTO rate_band (tax_year,kind,lower,upper,rate) VALUES
  -- income tax applies to TAXABLE pay (gross less allowance and pre-tax pension)
  (2026,'income',      0,  37700, 0.20),
  (2026,'income',  37700, 125140, 0.40),
  (2026,'income', 125140,   1e12, 0.45),
  (2026,'ni_ee',       0,  12570, 0.00),
  (2026,'ni_ee',   12570,  50270, 0.08),
  (2026,'ni_ee',   50270,   1e12, 0.02),
  (2026,'ni_er',       0,   5000, 0.00),
  (2026,'ni_er',    5000,   1e12, 0.15),
  (2026,'plan1',       0,  26065, 0.00), (2026,'plan1', 26065, 1e12, 0.09),
  (2026,'plan2',       0,  28470, 0.00), (2026,'plan2', 28470, 1e12, 0.09),
  (2026,'plan4',       0,  32745, 0.00), (2026,'plan4', 32745, 1e12, 0.09),
  (2026,'plan5',       0,  25000, 0.00), (2026,'plan5', 25000, 1e12, 0.09),
  (2026,'pgl',         0,  21000, 0.00), (2026,'pgl',   21000, 1e12, 0.06);
INSERT INTO rate_band (tax_year,kind,lower,upper,rate)
  SELECT 2025, kind, lower, upper, rate FROM rate_band WHERE tax_year = 2026;

-- ---------------------------------------------------------------- holidays ----
-- Bank holidays, England and Wales. 2025-2028 as published on gov.uk, including
-- substitute days; 2029-2030 by the same rules. Edit under Settings.
CREATE TABLE bank_holiday (
  date TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  name TEXT NOT NULL
);
INSERT INTO bank_holiday VALUES
  ('2025-01-01','New Year''s Day'),('2025-04-18','Good Friday'),('2025-04-21','Easter Monday'),
  ('2025-05-05','Early May bank holiday'),('2025-05-26','Spring bank holiday'),
  ('2025-08-25','Summer bank holiday'),('2025-12-25','Christmas Day'),('2025-12-26','Boxing Day'),
  ('2026-01-01','New Year''s Day'),('2026-04-03','Good Friday'),('2026-04-06','Easter Monday'),
  ('2026-05-04','Early May bank holiday'),('2026-05-25','Spring bank holiday'),
  ('2026-08-31','Summer bank holiday'),('2026-12-25','Christmas Day'),('2026-12-28','Boxing Day (substitute)'),
  ('2027-01-01','New Year''s Day'),('2027-03-26','Good Friday'),('2027-03-29','Easter Monday'),
  ('2027-05-03','Early May bank holiday'),('2027-05-31','Spring bank holiday'),
  ('2027-08-30','Summer bank holiday'),('2027-12-27','Christmas Day (substitute)'),
  ('2027-12-28','Boxing Day (substitute)'),
  ('2028-01-03','New Year''s Day (substitute)'),('2028-04-14','Good Friday'),('2028-04-17','Easter Monday'),
  ('2028-05-01','Early May bank holiday'),('2028-05-29','Spring bank holiday'),
  ('2028-08-28','Summer bank holiday'),('2028-12-25','Christmas Day'),('2028-12-26','Boxing Day'),
  ('2029-01-01','New Year''s Day'),('2029-03-30','Good Friday'),('2029-04-02','Easter Monday'),
  ('2029-05-07','Early May bank holiday'),('2029-05-28','Spring bank holiday'),
  ('2029-08-27','Summer bank holiday'),('2029-12-25','Christmas Day'),('2029-12-26','Boxing Day'),
  ('2030-01-01','New Year''s Day'),('2030-04-19','Good Friday'),('2030-04-22','Easter Monday'),
  ('2030-05-06','Early May bank holiday'),('2030-05-27','Spring bank holiday'),
  ('2030-08-26','Summer bank holiday'),('2030-12-25','Christmas Day'),('2030-12-26','Boxing Day');

-- Days off. Days is typed, so half days and odd arrangements just work. Only
-- holiday comes off the allowance; extra hours (time off in lieu) and other do not.
CREATE TABLE leave (
  id        INTEGER PRIMARY KEY,
  from_date TEXT NOT NULL CHECK (from_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  to_date   TEXT NOT NULL CHECK (to_date   GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  days      REAL NOT NULL DEFAULT 1,
  kind      TEXT NOT NULL DEFAULT 'holiday' CHECK (kind IN ('holiday','extra','other')),
  note      TEXT,
  CHECK (to_date >= from_date)
);
-- The allowance per holiday year (January to December). Bank holidays are on top.
CREATE TABLE leave_year (
  year      INTEGER PRIMARY KEY,
  allowance REAL NOT NULL DEFAULT 25,
  extra     REAL NOT NULL DEFAULT 0,      -- extra days earned, typed
  note      TEXT
);
INSERT INTO leave_year (year, allowance) VALUES (2026, 25), (2027, 25);

-- --------------------------------------------------------------- reminders ----
-- Bills and anything else that comes round. `start` is the first due date; the
-- rest follow every week, month, quarter or year. A bill tied to a payee ticks
-- itself off when that payee is paid within a week of the date; anything else
-- is ticked off by hand (done_through moves on).
CREATE TABLE reminder (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  start        TEXT NOT NULL CHECK (start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  every        TEXT NOT NULL DEFAULT 'month' CHECK (every IN ('once','week','month','quarter','year')),
  amount       REAL,
  merchant_id  INTEGER REFERENCES merchant(id) ON DELETE SET NULL,
  done_through TEXT CHECK (done_through IS NULL OR done_through GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note         TEXT
);
INSERT INTO reminder (title, start, every, note) VALUES
  ('P60: run the end of tax year check', '2027-05-31', 'year',
   'Employers must give you a P60 by 31 May. Pay → End of tax year.'),
  ('Tax code: check it matches your payslip', '2027-04-20', 'year',
   'A new tax year can bring a new code. Compare the letter from HMRC with Pay → My details.');
