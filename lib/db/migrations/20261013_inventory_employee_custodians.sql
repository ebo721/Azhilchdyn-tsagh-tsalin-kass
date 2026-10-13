CREATE TABLE IF NOT EXISTS inventory_custodian_employees (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_custodian_user_employee_idx ON inventory_custodian_employees(user_id, employee_id);
ALTER TABLE inventory_purchases ADD COLUMN IF NOT EXISTS responsible_employee_id integer REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE inventory_issues ADD COLUMN IF NOT EXISTS responsible_employee_id integer REFERENCES employees(id) ON DELETE SET NULL;
-- Legacy name snapshots remain untouched; never infer an employee from a free-form name.
