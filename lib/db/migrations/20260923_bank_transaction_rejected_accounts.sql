BEGIN;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS rejected_account_ids integer[] NOT NULL DEFAULT ARRAY[]::integer[];

COMMIT;