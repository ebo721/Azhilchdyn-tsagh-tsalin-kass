-- Roll back only after draining the new application. Refuse to discard entered metadata.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.employees WHERE social_insurance_profile IS NOT NULL) THEN
    RAISE EXCEPTION 'Insurance profiles have been entered. Back up and preserve them before rollback.';
  END IF;
END $$;
ALTER TABLE public.employees DROP COLUMN social_insurance_profile;
