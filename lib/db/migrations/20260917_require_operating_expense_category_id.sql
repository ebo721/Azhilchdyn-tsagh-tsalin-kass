BEGIN;

LOCK TABLE operating_expenses IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
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