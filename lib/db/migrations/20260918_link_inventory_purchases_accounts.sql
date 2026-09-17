BEGIN;

LOCK TABLE inventory_purchases IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO chart_of_accounts (code, name, type)
VALUES
  ('1500', 'Бараа материалын үлдэгдэл', 'asset'),
  ('1510', 'Хангамжийн материалын үлдэгдэл', 'asset')
ON CONFLICT (code) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM chart_of_accounts
    WHERE code IN ('1500', '1510')
      AND type <> 'asset'
  ) THEN
    RAISE EXCEPTION 'Reserved inventory account codes must have type asset';
  END IF;
END $$;

ALTER TABLE inventory_purchases
  ADD COLUMN IF NOT EXISTS account_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_purchases_account_id_chart_of_accounts_id_fk'
      AND conrelid = 'inventory_purchases'::regclass
  ) THEN
    ALTER TABLE inventory_purchases
      ADD CONSTRAINT inventory_purchases_account_id_chart_of_accounts_id_fk
      FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS inventory_purchases_account_id_idx
  ON inventory_purchases(account_id);

UPDATE inventory_purchases purchase
SET account_id = account.id
FROM chart_of_accounts account
WHERE account.code = CASE purchase.material_type
  WHEN 'food' THEN '1500'
  WHEN 'supply' THEN '1510'
END
AND account.type = 'asset'
AND purchase.material_type IN ('food', 'supply')
AND purchase.account_id IS DISTINCT FROM account.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM inventory_purchases purchase
    LEFT JOIN chart_of_accounts account ON account.id = purchase.account_id
    WHERE purchase.material_type IN ('food', 'supply')
      AND (
        account.id IS NULL
        OR account.type <> 'asset'
        OR account.code <> CASE purchase.material_type
          WHEN 'food' THEN '1500'
          WHEN 'supply' THEN '1510'
        END
      )
  ) THEN
    RAISE EXCEPTION 'Inventory purchase account mapping is incomplete or invalid';
  END IF;
END $$;

COMMIT;