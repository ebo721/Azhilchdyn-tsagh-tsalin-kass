BEGIN;

LOCK TABLE cash_transactions IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO chart_of_accounts (code, name, type)
VALUES
  ('1500', 'Бараа материалын үлдэгдэл', 'asset'),
  ('1510', 'Хангамжийн материалын үлдэгдэл', 'asset'),
  ('1800', 'Үндсэн хөрөнгө', 'asset'),
  ('4000', 'Борлуулалтын орлого', 'revenue'),
  ('6000', 'Цалингийн зардал', 'expense'),
  ('6900', 'Бусад үйл ажиллагааны зардал', 'expense')
ON CONFLICT (code) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM chart_of_accounts
    WHERE (code IN ('1500', '1510', '1800') AND type <> 'asset')
       OR (code = '4000' AND type <> 'revenue')
       OR (code IN ('6000', '6900') AND type <> 'expense')
  ) THEN
    RAISE EXCEPTION 'Reserved cash account codes have invalid types';
  END IF;
END $$;

ALTER TABLE cash_transactions
  ADD COLUMN IF NOT EXISTS account_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cash_transactions_account_id_chart_of_accounts_id_fk'
      AND conrelid = 'cash_transactions'::regclass
  ) THEN
    ALTER TABLE cash_transactions
      ADD CONSTRAINT cash_transactions_account_id_chart_of_accounts_id_fk
      FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cash_transactions_account_id_idx
  ON cash_transactions(account_id);

UPDATE cash_transactions cash
SET account_id = account.id
FROM chart_of_accounts account
WHERE account.code = CASE cash.category
  WHEN 'Бараа материал' THEN '1500'
  WHEN 'Хангамжийн материал' THEN '1510'
  WHEN 'Хүнсний бараа материал' THEN '1500'
  WHEN 'Цалин' THEN '6000'
  WHEN 'Урьдчилгаа цалин' THEN '6000'
  WHEN 'Эд хөрөнгө' THEN '1800'
  WHEN 'Үйл ажиллагааны зардал' THEN '6900'
  WHEN 'Таван толгой ХХК' THEN '4000'
END
AND cash.category IN (
  'Бараа материал',
  'Хангамжийн материал',
  'Хүнсний бараа материал',
  'Цалин',
  'Урьдчилгаа цалин',
  'Эд хөрөнгө',
  'Үйл ажиллагааны зардал',
  'Таван толгой ХХК'
)
AND cash.account_id IS DISTINCT FROM account.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cash_transactions cash
    LEFT JOIN chart_of_accounts account ON account.id = cash.account_id
    WHERE cash.category IN (
      'Бараа материал',
      'Хангамжийн материал',
      'Хүнсний бараа материал',
      'Цалин',
      'Урьдчилгаа цалин',
      'Эд хөрөнгө',
      'Үйл ажиллагааны зардал',
      'Таван толгой ХХК'
    )
    AND (
      account.id IS NULL
      OR account.code <> CASE cash.category
        WHEN 'Бараа материал' THEN '1500'
        WHEN 'Хангамжийн материал' THEN '1510'
        WHEN 'Хүнсний бараа материал' THEN '1500'
        WHEN 'Цалин' THEN '6000'
        WHEN 'Урьдчилгаа цалин' THEN '6000'
        WHEN 'Эд хөрөнгө' THEN '1800'
        WHEN 'Үйл ажиллагааны зардал' THEN '6900'
        WHEN 'Таван толгой ХХК' THEN '4000'
      END
    )
  ) THEN
    RAISE EXCEPTION 'Cash transaction account mapping is incomplete or invalid';
  END IF;
END $$;

COMMIT;