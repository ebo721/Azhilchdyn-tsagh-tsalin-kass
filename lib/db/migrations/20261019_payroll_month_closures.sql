-- Finalized payroll is a business record. This migration closes no existing month.
CREATE TABLE public.payroll_month_closures (
  month text PRIMARY KEY CHECK (month ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'),
  payroll jsonb NOT NULL,
  advance jsonb NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by integer NOT NULL
);

-- The existing statement-level source lock serializes these guards with closing.
CREATE FUNCTION public.guard_closed_payroll_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_data jsonb; new_data jsonb; blocked_month text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;
  IF old_data = new_data THEN RETURN NEW; END IF;
  SELECT c.month INTO blocked_month
  FROM public.payroll_month_closures c
  JOIN public.payroll_month_balances b ON b.month = c.month
  WHERE
    (TG_TABLE_NAME IN ('payroll_adjustments','payroll_advance_approvals')
      AND (c.month = old_data->>'month' OR c.month = new_data->>'month'))
    OR (TG_TABLE_NAME = 'attendance'
      AND ((old_data->>'date')::date BETWEEN b.period_start AND b.period_end
        OR (new_data->>'date')::date BETWEEN b.period_start AND b.period_end))
    OR (TG_TABLE_NAME = 'employee_salary_history'
      AND b.period_end >= LEAST((old_data->>'effective_from')::date, (new_data->>'effective_from')::date))
    OR (TG_TABLE_NAME = 'payroll_schedule_settings'
      AND c.month >= LEAST(old_data->>'effective_from_month', new_data->>'effective_from_month'))
  ORDER BY c.month DESC LIMIT 1;
  IF blocked_month IS NOT NULL THEN
    RAISE EXCEPTION 'Цалингийн % сар хаалттай. Админ эхлээд дахин нээнэ үү.', blocked_month USING ERRCODE = 'PCL01';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE source text;
BEGIN
  FOREACH source IN ARRAY ARRAY['attendance','employee_salary_history',
    'payroll_adjustments','payroll_advance_approvals','payroll_schedule_settings'] LOOP
    EXECUTE format('CREATE TRIGGER payroll_closed_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_closed_payroll_sources()', source);
  END LOOP;
END $$;

-- Global employee edits can invalidate open months, never a closed balance.
CREATE FUNCTION public.guard_closed_payroll_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payroll_month_closures WHERE month = OLD.month) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Цалингийн хаасан сарын үлдэгдлийг устгах боломжгүй.' USING ERRCODE = 'PCL01';
    END IF;
    IF NEW.lines IS DISTINCT FROM OLD.lines OR NEW.month <> OLD.month
      OR NEW.period_start <> OLD.period_start OR NEW.period_end <> OLD.period_end THEN
      RAISE EXCEPTION 'Цалингийн хаасан сарын үлдэгдлийг өөрчлөх боломжгүй.' USING ERRCODE = 'PCL01';
    END IF;
    NEW.dirty := false;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payroll_closed_balance_guard BEFORE UPDATE OR DELETE ON public.payroll_month_balances
FOR EACH ROW EXECUTE FUNCTION public.guard_closed_payroll_balance();

CREATE FUNCTION public.guard_closed_payroll_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payroll_month_closures WHERE month = OLD.month) THEN
    RAISE EXCEPTION 'Цалингийн хаасан сарын цаг, бодолтыг өөрчлөх боломжгүй.' USING ERRCODE = 'PCL01';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payroll_closed_snapshot_guard BEFORE UPDATE OR DELETE ON public.payroll_attendance_snapshots
FOR EACH ROW EXECUTE FUNCTION public.guard_closed_payroll_snapshot();
