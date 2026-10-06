-- Drain the new API first. These are derived balances only; source data stays intact.
DO $$
DECLARE source text;
BEGIN
  FOREACH source IN ARRAY ARRAY['attendance', 'employees', 'employee_salary_history',
    'payroll_adjustments', 'payroll_advance_approvals', 'payroll_schedule_settings'] LOOP
    EXECUTE format('DROP TRIGGER payroll_balance_invalidate ON public.%I', source);
    EXECUTE format('DROP TRIGGER payroll_balance_source_lock ON public.%I', source);
  END LOOP;
END $$;
DROP FUNCTION public.invalidate_payroll_month_balances();
DROP FUNCTION public.lock_payroll_balance_sources();
DROP INDEX public.attendance_payroll_date_idx;
DROP TABLE public.payroll_month_balances;
