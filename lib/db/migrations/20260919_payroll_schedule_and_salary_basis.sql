CREATE TABLE IF NOT EXISTS payroll_schedule_settings (
  id serial PRIMARY KEY,
  effective_from_month text NOT NULL DEFAULT '0001-01',
  period_start_day integer NOT NULL DEFAULT 1,
  advance_cutoff_day integer NOT NULL DEFAULT 15,
  period_end_day integer NOT NULL DEFAULT 31,
  advance_pay_day integer NOT NULL DEFAULT 15,
  final_pay_day integer NOT NULL DEFAULT 31,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payroll_schedule_settings ADD COLUMN IF NOT EXISTS effective_from_month text NOT NULL DEFAULT '0001-01';
CREATE UNIQUE INDEX IF NOT EXISTS payroll_schedule_settings_effective_month_idx ON payroll_schedule_settings (effective_from_month);

UPDATE employees
SET salary_type = CASE WHEN employee_type = 'shift' THEN 'daily' ELSE 'monthly' END
WHERE salary_type IS NULL OR salary_type NOT IN ('daily', 'monthly')
   OR (employee_type = 'shift' AND salary_type = 'hourly');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_salary_history'
      AND column_name = 'salary_type'
  ) THEN
    ALTER TABLE employee_salary_history ADD COLUMN salary_type text;
    IF to_regclass('employee_salary_history_basis_backup_20260919') IS NOT NULL THEN
      UPDATE employee_salary_history h
      SET salary_type = b.salary_type
      FROM employee_salary_history_basis_backup_20260919 b
      WHERE h.id = b.id;
    END IF;
    UPDATE employee_salary_history
    SET salary_type = CASE WHEN employee_type = 'shift' THEN 'daily' ELSE 'monthly' END
    WHERE salary_type IS NULL;
    ALTER TABLE employee_salary_history
      ALTER COLUMN salary_type SET DEFAULT 'monthly',
      ALTER COLUMN salary_type SET NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_salary_history'
      AND column_name = 'monthly_expected_work_days'
  ) THEN
    ALTER TABLE employee_salary_history ADD COLUMN monthly_expected_work_days integer;
    IF to_regclass('employee_salary_history_basis_backup_20260919') IS NOT NULL THEN
      UPDATE employee_salary_history h
      SET monthly_expected_work_days = b.monthly_expected_work_days
      FROM employee_salary_history_basis_backup_20260919 b
      WHERE h.id = b.id;
    END IF;
    UPDATE employee_salary_history AS history
    SET monthly_expected_work_days = COALESCE(employee.monthly_expected_work_days, 0)
    FROM employees AS employee
    WHERE employee.id = history.employee_id
      AND history.monthly_expected_work_days IS NULL;
    ALTER TABLE employee_salary_history
      ALTER COLUMN monthly_expected_work_days SET DEFAULT 0,
      ALTER COLUMN monthly_expected_work_days SET NOT NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('payroll_schedule_settings_backup_20260919') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM payroll_schedule_settings) THEN
    INSERT INTO payroll_schedule_settings
      (id, effective_from_month, period_start_day, advance_cutoff_day, period_end_day, advance_pay_day, final_pay_day, updated_at)
    SELECT id, effective_from_month, period_start_day, advance_cutoff_day, period_end_day, advance_pay_day, final_pay_day, updated_at
    FROM payroll_schedule_settings_backup_20260919
    ON CONFLICT (effective_from_month) DO NOTHING;
  END IF;
  IF to_regclass('employees_salary_type_backup_20260919') IS NOT NULL THEN
    UPDATE employees e SET salary_type = b.salary_type
    FROM employees_salary_type_backup_20260919 b
    WHERE e.id = b.id
      AND e.salary_type = 'hourly';
  END IF;
END $$;

INSERT INTO payroll_schedule_settings (effective_from_month)
VALUES ('0001-01')
ON CONFLICT (effective_from_month) DO NOTHING;