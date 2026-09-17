BEGIN;

LOCK TABLE operating_expenses IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  has_account_id boolean;
  has_category_id boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'operating_expenses'::regclass
      AND attname = 'account_id'
      AND NOT attisdropped
  ) INTO has_account_id;
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'operating_expenses'::regclass
      AND attname = 'category_id'
      AND NOT attisdropped
  ) INTO has_category_id;

  IF has_category_id AND NOT has_account_id THEN
    ALTER TABLE operating_expenses RENAME COLUMN category_id TO account_id;
  ELSIF has_category_id AND has_account_id THEN
    UPDATE operating_expenses
    SET account_id = category_id
    WHERE account_id IS NULL;
    ALTER TABLE operating_expenses
      DROP CONSTRAINT IF EXISTS operating_expenses_category_id_chart_of_accounts_id_fk;
    DROP INDEX IF EXISTS operating_expenses_category_id_idx;
    ALTER TABLE operating_expenses DROP COLUMN category_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'operating_expenses'::regclass
      AND conname = 'operating_expenses_category_id_chart_of_accounts_id_fk'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'operating_expenses'::regclass
      AND conname = 'operating_expenses_account_id_chart_of_accounts_id_fk'
  ) THEN
    ALTER TABLE operating_expenses
      RENAME CONSTRAINT operating_expenses_category_id_chart_of_accounts_id_fk
      TO operating_expenses_account_id_chart_of_accounts_id_fk;
  END IF;
END $$;
ALTER INDEX IF EXISTS operating_expenses_category_id_idx
  RENAME TO operating_expenses_account_id_idx;
ALTER TABLE operating_expenses ALTER COLUMN account_id SET NOT NULL;

COMMIT;