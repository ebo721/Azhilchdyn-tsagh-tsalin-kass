-- Additive: legacy first/second payments and their source keys remain unchanged.
ALTER TABLE public.payroll_adjustments
  ADD COLUMN additional_payments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.payroll_adjustments
  ADD CONSTRAINT payroll_additional_payments_array
  CHECK (jsonb_typeof(additional_payments) = 'array');
