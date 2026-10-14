-- DESTRUCTIVE: save purchase document numbers and counters before executing.
-- Purchase, stock, payment and journal records remain, but numbering history is lost.
DROP TRIGGER IF EXISTS inventory_purchases_document_number_trigger ON inventory_purchases;
DROP FUNCTION IF EXISTS assign_inventory_purchase_document_number();
DROP INDEX IF EXISTS inventory_purchases_document_number_idx;
ALTER TABLE inventory_purchases DROP COLUMN IF EXISTS document_number;
DROP TABLE IF EXISTS inventory_purchase_document_counters;
