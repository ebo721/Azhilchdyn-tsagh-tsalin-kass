BEGIN;

DROP TABLE IF EXISTS employee_pay_frequency_backup_20260920;
CREATE TABLE employee_pay_frequency_backup_20260920 AS
SELECT id, pay_frequency FROM employees;

DROP TABLE IF EXISTS employee_salary_history_pay_frequency_backup_20260920;
CREATE TABLE employee_salary_history_pay_frequency_backup_20260920 AS
SELECT id, pay_frequency FROM employee_salary_history;

ALTER TABLE employee_salary_history DROP COLUMN IF EXISTS pay_frequency;
ALTER TABLE employees DROP COLUMN IF EXISTS pay_frequency;

COMMIT;