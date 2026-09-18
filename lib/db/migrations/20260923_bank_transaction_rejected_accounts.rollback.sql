BEGIN;

ALTER TABLE bank_transactions
  DROP COLUMN IF EXISTS rejected_account_ids;

COMMIT;