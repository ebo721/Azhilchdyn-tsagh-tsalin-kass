BEGIN;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS pay_frequency text NOT NULL DEFAULT 'twice';

DO $$
BEGIN
  IF to_regclass('employee_pay_frequency_backup_20260920') IS NOT NULL THEN
    UPDATE employees AS employee
    SET pay_frequency = backup.pay_frequency
    FROM employee_pay_frequency_backup_20260920 AS backup
    WHERE employee.id = backup.id;
  END IF;
END $$;

ALTER TABLE employee_salary_history
  ADD COLUMN IF NOT EXISTS pay_frequency text;

DO $$
BEGIN
  IF to_regclass('employee_salary_history_pay_frequency_backup_20260920') IS NOT NULL THEN
    UPDATE employee_salary_history AS history
    SET pay_frequency = backup.pay_frequency
    FROM employee_salary_history_pay_frequency_backup_20260920 AS backup
    WHERE history.id = backup.id;
  END IF;
END $$;

UPDATE employee_salary_history AS history
SET pay_frequency = COALESCE(employee.pay_frequency, 'twice')
FROM employees AS employee
WHERE employee.id = history.employee_id
  AND history.pay_frequency IS NULL;

ALTER TABLE employee_salary_history
  ALTER COLUMN pay_frequency SET DEFAULT 'twice',
  ALTER COLUMN pay_frequency SET NOT NULL;

COMMIT;