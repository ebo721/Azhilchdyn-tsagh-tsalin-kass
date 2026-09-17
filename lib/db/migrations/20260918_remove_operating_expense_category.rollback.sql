BEGIN;

LOCK TABLE operating_expenses IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE operating_expenses ADD COLUMN IF NOT EXISTS category text;
UPDATE operating_expenses expense
SET category = COALESCE(
  (
    SELECT archive.category
    FROM operating_expenses_category_archive_20260918 archive
    WHERE archive.id = expense.id
  ),
  account.name
)
FROM chart_of_accounts account
WHERE account.id = expense.category_id
  AND expense.category IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM operating_expenses WHERE category IS NULL) THEN
    RAISE EXCEPTION 'Could not restore every operating expense category';
  END IF;
END $$;

ALTER TABLE operating_expenses ALTER COLUMN category SET NOT NULL;

COMMIT;