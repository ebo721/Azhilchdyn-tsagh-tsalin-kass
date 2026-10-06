-- Additive derived ledger. No attendance, salary or recorded payment is changed.
CREATE TABLE public.payroll_month_balances (
  month text PRIMARY KEY,
  period_start date NOT NULL,
  period_end date NOT NULL,
  lines jsonb NOT NULL,
  dirty boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_month_balances_month_check CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT payroll_month_balances_period_check CHECK (period_start <= period_end)
);
CREATE INDEX payroll_month_balances_dirty_idx ON public.payroll_month_balances (dirty, month);
CREATE INDEX attendance_payroll_date_idx ON public.attendance (date);

-- All source mutations take the lock BEFORE obtaining source row locks. The
-- calculator takes the same lock, so it never publishes a mixed financial snapshot.
CREATE FUNCTION public.lock_payroll_balance_sources() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('payroll-month-balances'));
  RETURN NULL;
END $$;

CREATE FUNCTION public.invalidate_payroll_month_balances() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  old_date date;
  new_date date;
  first_date date;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;

  IF TG_TABLE_NAME = 'attendance' THEN
    old_date := (old_data->>'date')::date;
    new_date := (new_data->>'date')::date;
    UPDATE public.payroll_month_balances SET dirty = true
    WHERE old_date BETWEEN period_start AND period_end
       OR new_date BETWEEN period_start AND period_end;
  ELSIF TG_TABLE_NAME IN ('payroll_adjustments', 'payroll_advance_approvals') THEN
    UPDATE public.payroll_month_balances SET dirty = true
    WHERE month = old_data->>'month' OR month = new_data->>'month';
  ELSIF TG_TABLE_NAME = 'payroll_schedule_settings' THEN
    UPDATE public.payroll_month_balances SET dirty = true
    WHERE month >= LEAST(old_data->>'effective_from_month', new_data->>'effective_from_month');
  ELSIF TG_TABLE_NAME = 'employee_salary_history' THEN
    first_date := LEAST((old_data->>'effective_from')::date, (new_data->>'effective_from')::date);
    UPDATE public.payroll_month_balances SET dirty = true WHERE period_end >= first_date;
  ELSIF TG_TABLE_NAME = 'employees' THEN
    -- Editing contact/reporting metadata does not change payroll.
    IF TG_OP = 'UPDATE' AND
      (old_data - ARRAY['name','role','phone','social_insurance_profile','status']) =
      (new_data - ARRAY['name','role','phone','social_insurance_profile','status']) THEN
      RETURN NULL;
    END IF;
    UPDATE public.payroll_month_balances SET dirty = true;
  END IF;
  RETURN NULL;
END $$;

DO $$
DECLARE source text;
BEGIN
  FOREACH source IN ARRAY ARRAY['attendance', 'employees', 'employee_salary_history',
    'payroll_adjustments', 'payroll_advance_approvals', 'payroll_schedule_settings'] LOOP
    EXECUTE format('CREATE TRIGGER payroll_balance_source_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.lock_payroll_balance_sources()', source);
    EXECUTE format('CREATE TRIGGER payroll_balance_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.invalidate_payroll_month_balances()', source);
  END LOOP;
END $$;
