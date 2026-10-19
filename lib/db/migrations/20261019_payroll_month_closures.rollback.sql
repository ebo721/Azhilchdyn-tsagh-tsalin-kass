-- Do not discard finalized business records during rollback.
-- Explicitly reopen every month in the app first, or preserve the new schema.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payroll_month_closures) THEN
    RAISE EXCEPTION 'Rollback blocked: finalized payroll months exist. Reopen them explicitly or retain the closure schema.';
  END IF;
END $$;
DROP TRIGGER payroll_closed_guard ON public.attendance;
DROP TRIGGER payroll_closed_guard ON public.employee_salary_history;
DROP TRIGGER payroll_closed_guard ON public.payroll_adjustments;
DROP TRIGGER payroll_closed_guard ON public.payroll_advance_approvals;
DROP TRIGGER payroll_closed_guard ON public.payroll_schedule_settings;
DROP TRIGGER payroll_closed_balance_guard ON public.payroll_month_balances;
DROP TRIGGER payroll_closed_snapshot_guard ON public.payroll_attendance_snapshots;
DROP FUNCTION public.guard_closed_payroll_sources();
DROP FUNCTION public.guard_closed_payroll_balance();
DROP FUNCTION public.guard_closed_payroll_snapshot();
DROP TABLE public.payroll_month_closures;
