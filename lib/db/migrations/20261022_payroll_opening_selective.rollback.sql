-- Destructive only to this feature's derived metadata and confirmation audit.
-- Refuse rollback once real confirmations exist; export/explicit recovery is required.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.payroll_opening_balances) THEN
    RAISE EXCEPTION 'Confirmed opening balances exist; do not discard financial confirmations during rollback';
  END IF;
END $$;
DO $$ DECLARE source text; BEGIN
  FOREACH source IN ARRAY ARRAY['employees','attendance','employee_salary_history','payroll_adjustments','payroll_advance_approvals','payroll_schedule_settings'] LOOP
    EXECUTE format('DROP TRIGGER payroll_employee_change ON public.%I',source);
  END LOOP;
END $$;
DROP FUNCTION public.track_employee_payroll_changes();
DROP FUNCTION public.mark_employee_payroll_change(integer,date,date,text,boolean);
ALTER TABLE public.payroll_month_balances DROP COLUMN earnings_dirty_employee_ids;
ALTER TABLE public.payroll_month_balances DROP COLUMN dirty_employee_ids;
DROP TABLE public.payroll_refresh_revision;
DROP TABLE public.payroll_opening_balances;
