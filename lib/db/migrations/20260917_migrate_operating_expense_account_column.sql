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

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

INSERT INTO chart_of_accounts (code, name, type)
VALUES
  ('1000', 'Касс', 'asset'),
  ('1100', 'Банкны харилцах', 'asset'),
  ('1200', 'Авлага', 'asset'),
  ('2000', 'Өглөг', 'liability'),
  ('3000', 'Эзэмшигчийн өмч', 'equity'),
  ('4000', 'Борлуулалтын орлого', 'income'),
  ('5000', 'Бараа материалын зардал (COGS)', 'expense'),
  ('6000', 'Цалингийн зардал', 'expense'),
  ('6100', 'Түрээсийн зардал', 'expense'),
  ('6200', 'Тээврийн зардал', 'expense'),
  ('6300', 'Цахилгаан, дулаан, ус', 'expense'),
  ('6400', 'Харилцаа холбоо, интернэт', 'expense'),
  ('6500', 'Засвар үйлчилгээ', 'expense'),
  ('6900', 'Бусад үйл ажиллагааны зардал', 'expense')
ON CONFLICT (code) DO NOTHING;

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

  IF has_account_id AND NOT has_category_id THEN
    ALTER TABLE operating_expenses RENAME COLUMN account_id TO category_id;
  ELSIF has_account_id AND has_category_id THEN
    UPDATE operating_expenses
    SET category_id = account_id
    WHERE category_id IS NULL;
    ALTER TABLE operating_expenses
      DROP CONSTRAINT IF EXISTS operating_expenses_account_id_chart_of_accounts_id_fk;
    DROP INDEX IF EXISTS operating_expenses_account_id_idx;
    ALTER TABLE operating_expenses DROP COLUMN account_id;
  ELSIF NOT has_category_id THEN
    ALTER TABLE operating_expenses ADD COLUMN category_id integer;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'operating_expenses'::regclass
      AND conname = 'operating_expenses_account_id_chart_of_accounts_id_fk'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'operating_expenses'::regclass
      AND conname = 'operating_expenses_category_id_chart_of_accounts_id_fk'
  ) THEN
    ALTER TABLE operating_expenses
      RENAME CONSTRAINT operating_expenses_account_id_chart_of_accounts_id_fk
      TO operating_expenses_category_id_chart_of_accounts_id_fk;
  END IF;
END $$;
ALTER INDEX IF EXISTS operating_expenses_account_id_idx
  RENAME TO operating_expenses_category_id_idx;

UPDATE operating_expenses expense
SET category_id = account.id
FROM chart_of_accounts account
WHERE expense.category_id IS NULL
  AND account.code = CASE
    WHEN lower(expense.category) LIKE '%түрээс%' THEN '6100'
    WHEN lower(expense.category) LIKE '%тээвэр%' OR lower(expense.category) LIKE '%шатахуун%' THEN '6200'
    WHEN lower(expense.category) LIKE '%цахилгаан%' OR lower(expense.category) LIKE '%дулаан%' OR lower(expense.category) LIKE '%ус%' THEN '6300'
    WHEN lower(expense.category) LIKE '%интернет%' OR lower(expense.category) LIKE '%холбоо%' THEN '6400'
    WHEN lower(expense.category) LIKE '%засвар%' THEN '6500'
    ELSE '6900'
  END
  AND account.type = 'expense';

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
    RAISE EXCEPTION 'Operating expense category migration is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'operating_expenses'::regclass
      AND conname = 'operating_expenses_category_id_chart_of_accounts_id_fk'
  ) THEN
    ALTER TABLE operating_expenses
      ADD CONSTRAINT operating_expenses_category_id_chart_of_accounts_id_fk
      FOREIGN KEY (category_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS operating_expenses_category_id_idx
  ON operating_expenses(category_id);

COMMIT;