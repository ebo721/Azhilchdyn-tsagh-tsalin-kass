BEGIN;

LOCK TABLE operating_expenses IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS operating_expenses_category_backup_20260917 AS
SELECT id, category
FROM operating_expenses
WITH NO DATA;
CREATE UNIQUE INDEX IF NOT EXISTS operating_expenses_category_backup_20260917_id_idx
  ON operating_expenses_category_backup_20260917(id);
INSERT INTO operating_expenses_category_backup_20260917 (id, category)
SELECT id, category
FROM operating_expenses
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'operating_expenses'::regclass
      AND attname = 'account_id'
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Legacy operating_expenses.account_id still exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM operating_expenses expense
    LEFT JOIN chart_of_accounts account ON account.id = expense.category_id
    WHERE expense.category_id IS NULL
       OR account.id IS NULL
       OR account.type <> 'expense'
  ) THEN
    RAISE EXCEPTION 'Operating expense category preflight failed';
  END IF;

  IF (
    SELECT count(*) FROM operating_expenses_category_backup_20260917
  ) <> (
    SELECT count(*) FROM operating_expenses
  ) THEN
    RAISE EXCEPTION 'Operating expense legacy category backup is incomplete';
  END IF;
END $$;

ALTER TABLE operating_expenses ALTER COLUMN category_id SET NOT NULL;

COMMIT;