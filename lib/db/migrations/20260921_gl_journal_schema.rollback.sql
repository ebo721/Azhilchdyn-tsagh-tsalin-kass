ALTER TABLE payroll_adjustments DROP COLUMN IF EXISTS journal_entry_id;
ALTER TABLE inventory_purchases DROP COLUMN IF EXISTS journal_entry_id;
ALTER TABLE bank_transactions DROP COLUMN IF EXISTS journal_entry_id;
ALTER TABLE cash_transactions DROP COLUMN IF EXISTS journal_entry_id;

DROP TABLE IF EXISTS journal_lines;
DROP TABLE IF EXISTS journal_entries;

ALTER TABLE chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_of_accounts_normal_balance_check,
  DROP CONSTRAINT IF EXISTS chart_of_accounts_type_check,
  DROP COLUMN IF EXISTS is_active,
  DROP COLUMN IF EXISTS normal_balance;