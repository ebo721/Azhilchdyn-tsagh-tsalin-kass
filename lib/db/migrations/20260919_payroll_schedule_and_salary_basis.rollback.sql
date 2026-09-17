BEGIN;

DO $$
BEGIN
  IF to_regclass('payroll_schedule_settings') IS NOT NULL THEN
    DROP TABLE IF EXISTS payroll_schedule_settings_backup_20260919;
    CREATE TABLE payroll_schedule_settings_backup_20260919 AS SELECT * FROM payroll_schedule_settings;
  END IF;
  IF to_regclass('employee_salary_history') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'employee_salary_history' AND column_name = 'salary_type'
     ) THEN
    DROP TABLE IF EXISTS employee_salary_history_basis_backup_20260919;
    CREATE TABLE employee_salary_history_basis_backup_20260919 AS
      SELECT id, employee_id, salary_type, monthly_expected_work_days FROM employee_salary_history;
  END IF;
  IF to_regclass('employees') IS NOT NULL THEN
    DROP TABLE IF EXISTS employees_salary_type_backup_20260919;
    CREATE TABLE employees_salary_type_backup_20260919 AS SELECT id, salary_type FROM employees;
    UPDATE employees SET salary_type = 'hourly'
    WHERE employee_type = 'shift' AND salary_type = 'daily';
  END IF;
END $$;

-- Keep backups for audit/recovery; only remove the additive columns/table.
DO $$
BEGIN
  IF to_regclass('employee_salary_history') IS NOT NULL THEN
    ALTER TABLE employee_salary_history
      DROP COLUMN IF EXISTS salary_type,
      DROP COLUMN IF EXISTS monthly_expected_work_days;
  END IF;
  IF to_regclass('payroll_schedule_settings') IS NOT NULL THEN
    DROP TABLE payroll_schedule_settings;
  END IF;
END $$;

COMMIT;