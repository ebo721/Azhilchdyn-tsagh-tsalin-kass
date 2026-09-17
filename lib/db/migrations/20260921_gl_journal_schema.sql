ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS normal_balance text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

UPDATE chart_of_accounts
SET type = lower(trim(type));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM chart_of_accounts
    WHERE type NOT IN ('asset', 'liability', 'equity', 'revenue', 'expense')
  ) THEN
    RAISE EXCEPTION 'chart_of_accounts contains an unsupported account type';
  END IF;
END
$$;

UPDATE chart_of_accounts
SET normal_balance = CASE
  WHEN code = '1810' AND type = 'asset' THEN 'credit'
  WHEN type IN ('asset', 'expense') THEN 'debit'
  ELSE 'credit'
END;

ALTER TABLE chart_of_accounts
  ALTER COLUMN normal_balance SET NOT NULL;

ALTER TABLE chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_of_accounts_type_check,
  ADD CONSTRAINT chart_of_accounts_type_check
    CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  DROP CONSTRAINT IF EXISTS chart_of_accounts_normal_balance_check,
  ADD CONSTRAINT chart_of_accounts_normal_balance_check
    CHECK (normal_balance IN ('debit', 'credit'));

CREATE TABLE IF NOT EXISTS journal_entries (
  id serial PRIMARY KEY,
  date date NOT NULL,
  description text NOT NULL,
  source_type text NOT NULL,
  source_id integer,
  status text NOT NULL DEFAULT 'draft',
  created_by integer REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by integer REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT journal_entries_status_check CHECK (status IN ('draft', 'posted', 'void'))
);

CREATE INDEX IF NOT EXISTS journal_entries_source_idx
  ON journal_entries (source_type, source_id);
CREATE INDEX IF NOT EXISTS journal_entries_date_idx
  ON journal_entries (date);

CREATE TABLE IF NOT EXISTS journal_lines (
  id serial PRIMARY KEY,
  journal_entry_id integer NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id integer NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  debit numeric(14, 2) NOT NULL DEFAULT 0,
  credit numeric(14, 2) NOT NULL DEFAULT 0,
  memo text,
  CONSTRAINT journal_lines_one_side_check CHECK (
    (debit > 0 AND credit = 0)
    OR (credit > 0 AND debit = 0)
  )
);

CREATE INDEX IF NOT EXISTS journal_lines_entry_idx
  ON journal_lines (journal_entry_id);
CREATE INDEX IF NOT EXISTS journal_lines_account_idx
  ON journal_lines (account_id);

ALTER TABLE cash_transactions
  ADD COLUMN IF NOT EXISTS journal_entry_id integer REFERENCES journal_entries(id) ON DELETE SET NULL;
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS journal_entry_id integer REFERENCES journal_entries(id) ON DELETE SET NULL;
ALTER TABLE inventory_purchases
  ADD COLUMN IF NOT EXISTS journal_entry_id integer REFERENCES journal_entries(id) ON DELETE SET NULL;
ALTER TABLE payroll_adjustments
  ADD COLUMN IF NOT EXISTS journal_entry_id integer REFERENCES journal_entries(id) ON DELETE SET NULL;