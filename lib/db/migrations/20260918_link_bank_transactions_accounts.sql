BEGIN;

LOCK TABLE bank_transactions IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS account_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bank_transactions_account_id_chart_of_accounts_id_fk'
      AND conrelid = 'bank_transactions'::regclass
  ) THEN
    ALTER TABLE bank_transactions
      ADD CONSTRAINT bank_transactions_account_id_chart_of_accounts_id_fk
      FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bank_transactions_account_id_idx
  ON bank_transactions(account_id);

COMMIT;