-- Savings, investments and pensions, all counted the same way.

-- Money you put in or took out of a savings, investment or pension account, typed in or read
-- off a statement, for accounts whose bank statements you do not import.
CREATE TABLE contribution (
  id         INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  date       TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount     REAL NOT NULL,                 -- + paid in, - taken out
  note       TEXT
);
CREATE INDEX ix_contribution ON contribution(account_id, date);

-- The statement a valuation was read from, kept with it (loaded only when opened).
CREATE TABLE valuation_file (
  valuation_id INTEGER PRIMARY KEY REFERENCES valuation(id) ON DELETE CASCADE,
  name         TEXT,
  data         TEXT NOT NULL CHECK (data GLOB 'data:application/pdf;base64,*') CHECK (LENGTH(data) <= 14000000)
);

-- Which pension a payslip's contributions went to, when not the usual one (a new job, a new scheme).
ALTER TABLE payslip ADD COLUMN pension_account_id INTEGER REFERENCES account(id) ON DELETE SET NULL;
