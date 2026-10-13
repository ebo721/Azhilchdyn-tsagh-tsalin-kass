DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM inventory_custodian_employees)
    OR EXISTS (SELECT 1 FROM inventory_purchases WHERE responsible_employee_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM inventory_issues WHERE responsible_employee_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Employee custodian data exists; rollback refused to prevent assignment loss';
  END IF;
END $$;
ALTER TABLE inventory_purchases DROP COLUMN IF EXISTS responsible_employee_id;
ALTER TABLE inventory_issues DROP COLUMN IF EXISTS responsible_employee_id;
DROP TABLE IF EXISTS inventory_custodian_employees;
