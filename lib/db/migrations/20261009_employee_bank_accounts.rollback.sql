-- Destructive rollback: export recipient accounts before applying this file.
ALTER TABLE public.employees DROP COLUMN IF EXISTS bank_account_number;
