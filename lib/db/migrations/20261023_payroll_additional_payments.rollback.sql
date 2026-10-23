-- Never discard additional payment data during rollback.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payroll_adjustments WHERE additional_payments <> '[]'::jsonb) THEN
    RAISE EXCEPTION 'Additional payroll payments exist; keep the new API and reconcile before rollback';
  END IF;
END $$;
ALTER TABLE public.payroll_adjustments DROP CONSTRAINT payroll_additional_payments_array;
ALTER TABLE public.payroll_adjustments DROP COLUMN additional_payments;
