\set ON_ERROR_STOP on

-- Run from the repository root:
-- psql "$DATABASE_URL" -X -f lib/db/migrations/tests/operating_expense_category_retirement.sql

DROP SCHEMA IF EXISTS test_expense_account_only CASCADE;
CREATE SCHEMA test_expense_account_only;
SET search_path TO test_expense_account_only;

CREATE TABLE operating_expenses (
  id serial PRIMARY KEY,
  description text NOT NULL,
  category text NOT NULL,
  date date NOT NULL,
  amount numeric(14,2) NOT NULL
);
CREATE TABLE chart_of_accounts (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO operating_expenses (description, category, date, amount)
VALUES ('account-only row', 'Түрээс', '2026-01-01', 100);
\ir ../20260917_link_operating_expenses_accounts.sql
\ir ../20260917_migrate_operating_expense_account_column.sql
\ir ../20260917_require_operating_expense_category_id.sql
\ir ../20260918_remove_operating_expense_category.sql

DO $$
BEGIN
  IF (SELECT count(*) FROM operating_expenses WHERE category_id IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'account_id-only path did not map every row';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'operating_expenses'::regclass
      AND attname IN ('account_id', 'category')
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'account_id-only path retained a legacy column';
  END IF;
  IF (SELECT count(*) FROM operating_expenses_category_archive_20260918) <> 1 THEN
    RAISE EXCEPTION 'account_id-only archive is incomplete';
  END IF;
END $$;

\ir ../20260918_remove_operating_expense_category.rollback.sql
\ir ../20260917_require_operating_expense_category_id.rollback.sql
\ir ../20260917_migrate_operating_expense_account_column.rollback.sql
INSERT INTO operating_expenses (description, category, account_id, date, amount)
SELECT 'old app after rollback', 'Бусад', id, '2026-01-02', 200
FROM chart_of_accounts WHERE code = '6900';

DROP SCHEMA test_expense_account_only CASCADE;

DROP SCHEMA IF EXISTS test_expense_category_only CASCADE;
CREATE SCHEMA test_expense_category_only;
SET search_path TO test_expense_category_only;

CREATE TABLE chart_of_accounts (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO chart_of_accounts (code, name, type)
VALUES ('6100', 'Түрээсийн зардал', 'expense');
CREATE TABLE operating_expenses (
  id serial PRIMARY KEY,
  description text NOT NULL,
  category text NOT NULL,
  category_id integer REFERENCES chart_of_accounts(id),
  date date NOT NULL,
  amount numeric(14,2) NOT NULL
);
INSERT INTO operating_expenses (description, category, category_id, date, amount)
SELECT 'category-only row', 'Түрээс', id, '2026-02-01', 100
FROM chart_of_accounts WHERE code = '6100';
\ir ../20260917_migrate_operating_expense_account_column.sql
\ir ../20260917_require_operating_expense_category_id.sql
\ir ../20260918_remove_operating_expense_category.sql

DO $$
BEGIN
  IF (SELECT count(*) FROM operating_expenses WHERE category_id IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'category_id-only path did not retain every mapping';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'operating_expenses'::regclass
      AND attname IN ('account_id', 'category')
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'category_id-only path retained a legacy column';
  END IF;
  IF (SELECT count(*) FROM operating_expenses_category_archive_20260918) <> 1 THEN
    RAISE EXCEPTION 'category_id-only archive is incomplete';
  END IF;
END $$;

DROP SCHEMA test_expense_category_only CASCADE;

DROP SCHEMA IF EXISTS test_expense_dual_column CASCADE;
CREATE SCHEMA test_expense_dual_column;
SET search_path TO test_expense_dual_column;

CREATE TABLE chart_of_accounts (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO chart_of_accounts (code, name, type)
VALUES
  ('6100', 'Түрээсийн зардал', 'expense'),
  ('6900', 'Бусад үйл ажиллагааны зардал', 'expense');
CREATE TABLE operating_expenses (
  id serial PRIMARY KEY,
  description text NOT NULL,
  category text NOT NULL,
  account_id integer NOT NULL REFERENCES chart_of_accounts(id),
  category_id integer REFERENCES chart_of_accounts(id),
  date date NOT NULL,
  amount numeric(14,2) NOT NULL
);
INSERT INTO operating_expenses (description, category, account_id, category_id, date, amount)
SELECT 'dual uses account', 'Түрээс', rent.id, NULL, '2026-03-01', 100
FROM chart_of_accounts rent WHERE rent.code = '6100';
INSERT INTO operating_expenses (description, category, account_id, category_id, date, amount)
SELECT 'dual keeps category id', 'Бусад', rent.id, other.id, '2026-03-02', 200
FROM chart_of_accounts rent
CROSS JOIN chart_of_accounts other
WHERE rent.code = '6100' AND other.code = '6900';
\ir ../20260917_migrate_operating_expense_account_column.sql
\ir ../20260917_require_operating_expense_category_id.sql
\ir ../20260918_remove_operating_expense_category.sql

DO $$
BEGIN
  IF (SELECT count(*) FROM operating_expenses WHERE category_id IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'dual-column path did not map every row';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'operating_expenses'::regclass
      AND attname IN ('account_id', 'category')
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'dual-column path retained a legacy column';
  END IF;
  IF (SELECT count(*) FROM operating_expenses_category_archive_20260918) <> 2 THEN
    RAISE EXCEPTION 'dual-column archive is incomplete';
  END IF;
END $$;

DROP SCHEMA test_expense_dual_column CASCADE;
RESET search_path;