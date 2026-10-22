-- Additive employee-scoped invalidation and explicitly verified financial anchors.
-- Does not certify any existing balance or alter source attendance/payments.
CREATE TABLE public.payroll_opening_balances (
  id serial PRIMARY KEY,
  month text NOT NULL CHECK (month ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  note text NOT NULL,
  confirmed_by integer NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  review_employee_ids jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE public.payroll_refresh_revision (id integer PRIMARY KEY CHECK (id=1), revision integer NOT NULL DEFAULT 0);
INSERT INTO public.payroll_refresh_revision (id) VALUES (1);
ALTER TABLE public.payroll_month_balances ADD COLUMN dirty_employee_ids jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.payroll_month_balances ADD COLUMN earnings_dirty_employee_ids jsonb NOT NULL DEFAULT '[]';
UPDATE public.payroll_month_balances b SET dirty_employee_ids =
  COALESCE((SELECT jsonb_agg(DISTINCT x->'employeeId') FROM jsonb_array_elements(b.lines) x), '[]')
WHERE dirty AND NOT EXISTS (SELECT 1 FROM public.payroll_month_closures c WHERE c.month=b.month);
UPDATE public.payroll_month_balances SET earnings_dirty_employee_ids=dirty_employee_ids;

CREATE FUNCTION public.mark_employee_payroll_change(employee integer, start_date date, end_date date, source_month text, is_earning boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE baseline record;
BEGIN
  UPDATE public.payroll_month_balances b
    SET dirty = true, updated_at = clock_timestamp(),
      dirty_employee_ids = CASE WHEN b.dirty_employee_ids @> jsonb_build_array(employee)
        THEN b.dirty_employee_ids ELSE b.dirty_employee_ids || jsonb_build_array(employee) END,
      earnings_dirty_employee_ids = CASE WHEN NOT is_earning OR b.earnings_dirty_employee_ids @> jsonb_build_array(employee)
        THEN b.earnings_dirty_employee_ids ELSE b.earnings_dirty_employee_ids || jsonb_build_array(employee) END
    WHERE NOT EXISTS (SELECT 1 FROM public.payroll_month_closures c WHERE c.month=b.month)
      AND (CASE WHEN source_month IS NOT NULL THEN b.month=source_month
        ELSE b.period_end >= start_date AND (end_date IS NULL OR b.period_start <= end_date) END);
  SELECT * INTO baseline FROM public.payroll_opening_balances ORDER BY id DESC LIMIT 1;
  IF baseline.id IS NOT NULL AND
    (CASE WHEN source_month IS NOT NULL THEN source_month <= baseline.month
      ELSE start_date <= COALESCE((SELECT period_end FROM public.payroll_month_balances WHERE month=baseline.month),
        (baseline.month || '-01')::date + interval '1 month - 1 day') END) THEN
    UPDATE public.payroll_opening_balances
      SET review_employee_ids = CASE WHEN review_employee_ids @> jsonb_build_array(employee)
        THEN review_employee_ids ELSE review_employee_ids || jsonb_build_array(employee) END
      WHERE id=baseline.id;
  END IF;
END $$;

CREATE FUNCTION public.track_employee_payroll_changes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a jsonb; b jsonb; employee integer; first_date date; last_date date; target_month text; pair record;
BEGIN
  IF TG_OP <> 'INSERT' THEN a := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN b := to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME='employees' THEN
    IF TG_OP='UPDATE' AND
      (a - ARRAY['name','role','phone','bank_account_number','social_insurance_profile','status']) =
      (b - ARRAY['name','role','phone','bank_account_number','social_insurance_profile','status']) THEN RETURN NULL; END IF;
    employee := COALESCE((b->>'id')::integer,(a->>'id')::integer);
    IF TG_OP <> 'UPDATE' OR a->>'joined_at' IS DISTINCT FROM b->>'joined_at' THEN
      first_date := LEAST((a->>'joined_at')::date,(b->>'joined_at')::date);
    ELSIF a->>'inactive_at' IS DISTINCT FROM b->>'inactive_at' THEN
      first_date := LEAST((a->>'inactive_at')::date,(b->>'inactive_at')::date);
    ELSE
      -- Employee updates and their dated history insert share a transaction.
      -- This deferred trigger sees the FINAL latest row, including future rules.
      SELECT max(effective_from) INTO first_date FROM public.employee_salary_history WHERE employee_id=employee;
      first_date := COALESCE(first_date,(b->>'joined_at')::date,(a->>'joined_at')::date);
    END IF;
    PERFORM public.mark_employee_payroll_change(employee,first_date,NULL,NULL);
  ELSIF TG_TABLE_NAME='payroll_advance_approvals' THEN
    FOR pair IN
      SELECT COALESCE(x->>'employeeId',y->>'employeeId')::integer AS employee_id
      FROM jsonb_array_elements(COALESCE(a->'lines','[]')) x
      FULL JOIN jsonb_array_elements(COALESCE(b->'lines','[]')) y ON x->>'employeeId'=y->>'employeeId'
      WHERE x IS DISTINCT FROM y
    LOOP
      IF a->>'month' IS NOT NULL THEN PERFORM public.mark_employee_payroll_change(pair.employee_id,NULL,NULL,a->>'month',false); END IF;
      IF b->>'month' IS NOT NULL THEN PERFORM public.mark_employee_payroll_change(pair.employee_id,NULL,NULL,b->>'month',false); END IF;
    END LOOP;
  ELSIF TG_TABLE_NAME='payroll_schedule_settings' THEN
    target_month := LEAST(a->>'effective_from_month',b->>'effective_from_month');
    FOR employee IN SELECT id FROM public.employees LOOP
      PERFORM public.mark_employee_payroll_change(employee,(target_month || '-01')::date,NULL,NULL);
    END LOOP;
  ELSE
    IF TG_TABLE_NAME='attendance' THEN
      first_date := LEAST((a->>'date')::date,(b->>'date')::date);
      last_date := GREATEST((a->>'date')::date,(b->>'date')::date);
    ELSIF TG_TABLE_NAME='employee_salary_history' THEN
      first_date := LEAST((a->>'effective_from')::date,(b->>'effective_from')::date);
    END IF;
    FOR employee IN SELECT DISTINCT value FROM unnest(ARRAY[(a->>'employee_id')::integer,(b->>'employee_id')::integer]) AS value WHERE value IS NOT NULL LOOP
      IF TG_TABLE_NAME='payroll_adjustments' THEN
        IF a->>'month' IS NOT NULL THEN PERFORM public.mark_employee_payroll_change(employee,NULL,NULL,a->>'month',false); END IF;
        IF b->>'month' IS NOT NULL THEN PERFORM public.mark_employee_payroll_change(employee,NULL,NULL,b->>'month',false); END IF;
      ELSE
        PERFORM public.mark_employee_payroll_change(employee,first_date,last_date,NULL);
      END IF;
    END LOOP;
  END IF;
  UPDATE public.payroll_refresh_revision SET revision=revision+1 WHERE id=1;
  RETURN NULL;
END $$;

DO $$
DECLARE source text;
BEGIN
  FOREACH source IN ARRAY ARRAY['attendance','employee_salary_history','payroll_adjustments','payroll_advance_approvals','payroll_schedule_settings'] LOOP
    EXECUTE format('CREATE TRIGGER payroll_employee_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.track_employee_payroll_changes()',source);
  END LOOP;
END $$;
CREATE CONSTRAINT TRIGGER payroll_employee_change AFTER INSERT OR UPDATE OR DELETE ON public.employees
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.track_employee_payroll_changes();
