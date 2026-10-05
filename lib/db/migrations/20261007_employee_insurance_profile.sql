-- Optional reporting metadata; no existing employee or salary values are changed.
ALTER TABLE public.employees ADD COLUMN social_insurance_profile jsonb;
