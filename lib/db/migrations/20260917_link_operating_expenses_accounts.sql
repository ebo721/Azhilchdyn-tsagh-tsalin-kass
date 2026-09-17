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
BEGIN
  IF EXISTS (
    SELECT 1
    FROM chart_of_accounts
    WHERE code IN ('6100', '6200', '6300', '6400', '6500', '6900')
      AND type <> 'expense'
  ) THEN
    RAISE EXCEPTION 'Reserved operating expense account codes must have type expense';
  END IF;
END $$;

ALTER TABLE operating_expenses ADD COLUMN IF NOT EXISTS category_id integer;

UPDATE operating_expenses expense
SET category_id = account.id
FROM chart_of_accounts account
WHERE account.code = CASE
  WHEN lower(expense.category) LIKE '%түрээс%' THEN '6100'
  WHEN lower(expense.category) LIKE '%тээвэр%' OR lower(expense.category) LIKE '%шатахуун%' THEN '6200'
  WHEN lower(expense.category) LIKE '%цахилгаан%' OR lower(expense.category) LIKE '%дулаан%' OR lower(expense.category) LIKE '%ус%' THEN '6300'
  WHEN lower(expense.category) LIKE '%интернет%' OR lower(expense.category) LIKE '%холбоо%' THEN '6400'
  WHEN lower(expense.category) LIKE '%засвар%' THEN '6500'
  ELSE '6900'
END
AND account.type = 'expense'
AND expense.category_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM operating_expenses WHERE category_id IS NULL) THEN
    RAISE EXCEPTION 'Operating expense account mapping is incomplete';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'operating_expenses_category_id_chart_of_accounts_id_fk'
  ) THEN
    ALTER TABLE operating_expenses
      ADD CONSTRAINT operating_expenses_category_id_chart_of_accounts_id_fk
      FOREIGN KEY (category_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS operating_expenses_category_id_idx ON operating_expenses(category_id);

COMMIT;