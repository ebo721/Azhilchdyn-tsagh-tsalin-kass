BEGIN;

ALTER TABLE operating_expenses ALTER COLUMN category_id DROP NOT NULL;

-- Keep operating_expenses_category_backup_20260917 for data recovery.

COMMIT;