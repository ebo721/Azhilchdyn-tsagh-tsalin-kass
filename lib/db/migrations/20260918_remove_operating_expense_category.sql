BEGIN;

LOCK TABLE operating_expenses IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS operating_expenses_category_archive_20260918 (
  id integer PRIMARY KEY,
  category text NOT NULL
);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'operating_expenses'::regclass
      AND attname = 'category'
      AND NOT attisdropped
  ) THEN
    INSERT INTO operating_expenses_category_archive_20260918 (id, category)
    SELECT expense.id, expense.category
    FROM operating_expenses expense
    JOIN chart_of_accounts account ON account.id = expense.category_id
    WHERE account.type = 'expense'
    ON CONFLICT (id) DO UPDATE SET category = EXCLUDED.category;

    IF EXISTS (
      SELECT 1
      FROM operating_expenses expense
      LEFT JOIN operating_expenses_category_archive_20260918 archive ON archive.id = expense.id
      WHERE archive.id IS NULL
    ) THEN
      RAISE EXCEPTION 'Operating expense category archive is incomplete';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM operating_expenses expense
    LEFT JOIN chart_of_accounts account ON account.id = expense.category_id
    WHERE account.id IS NULL OR account.type <> 'expense'
  ) THEN
    RAISE EXCEPTION 'Operating expense category_id references an invalid expense account';
  END IF;
END $$;

ALTER TABLE operating_expenses DROP COLUMN IF EXISTS category;

COMMIT;