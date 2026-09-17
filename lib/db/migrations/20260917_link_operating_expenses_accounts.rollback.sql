BEGIN;

LOCK TABLE operating_expenses IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE operating_expenses
  DROP CONSTRAINT IF EXISTS operating_expenses_category_id_chart_of_accounts_id_fk;
DROP INDEX IF EXISTS operating_expenses_category_id_idx;
ALTER TABLE operating_expenses DROP COLUMN IF EXISTS category_id;

-- The backup table is deliberately retained until the migration is accepted.
-- Restore category snapshots if a later data correction changed them:
UPDATE operating_expenses expense
SET category = backup.category
FROM operating_expenses_category_backup_20260917 backup
WHERE expense.id = backup.id;

COMMIT;