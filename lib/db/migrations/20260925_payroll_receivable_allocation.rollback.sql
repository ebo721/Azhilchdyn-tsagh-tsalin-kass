ALTER TABLE "payroll_adjustments"
  DROP CONSTRAINT IF EXISTS "payroll_adjustments_receivable_id_receivables_id_fk";

ALTER TABLE "payroll_adjustments"
  DROP COLUMN IF EXISTS "receivable_id";