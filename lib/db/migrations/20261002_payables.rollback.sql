DROP TRIGGER IF EXISTS payables_employee_restrict_trigger ON employees;
DROP TRIGGER IF EXISTS payables_supplier_restrict_trigger ON inventory_suppliers;
DROP TABLE IF EXISTS payable_allocations;
DROP TABLE IF EXISTS payables;
DROP FUNCTION IF EXISTS validate_payable_settlement_line_links();
DROP FUNCTION IF EXISTS restrict_payable_party_removal();
DROP FUNCTION IF EXISTS validate_payable_party();