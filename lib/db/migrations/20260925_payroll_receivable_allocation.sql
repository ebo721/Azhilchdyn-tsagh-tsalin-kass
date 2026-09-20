ALTER TABLE "payroll_adjustments"
  ADD COLUMN IF NOT EXISTS "receivable_id" integer;

DO $$ BEGIN
  ALTER TABLE "payroll_adjustments"
    ADD CONSTRAINT "payroll_adjustments_receivable_id_receivables_id_fk"
    FOREIGN KEY ("receivable_id") REFERENCES "public"."receivables"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;