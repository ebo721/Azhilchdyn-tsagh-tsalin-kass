BEGIN;

LOCK TABLE operating_expenses IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE operating_expenses_account_backup_20260917 AS
SELECT id, category
FROM operating_expenses;

INSERT INTO chart_of_accounts (code, name, type)
VALUES
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

ALTER TABLE operating_expenses ADD COLUMN account_id integer;

UPDATE operating_expenses expense
SET account_id = account.id
FROM chart_of_accounts account
WHERE account.code = CASE
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
  IF EXISTS (SELECT 1 FROM operating_expenses WHERE account_id IS NULL) THEN
    RAISE EXCEPTION 'Operating expense account mapping is incomplete';
  END IF;
END $$;

ALTER TABLE operating_expenses ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE operating_expenses
  ADD CONSTRAINT operating_expenses_account_id_chart_of_accounts_id_fk
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT;
CREATE INDEX operating_expenses_account_id_idx ON operating_expenses(account_id);

COMMIT;