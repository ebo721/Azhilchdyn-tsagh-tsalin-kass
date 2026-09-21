DROP TABLE IF EXISTS receivable_allocations;
DROP TABLE IF EXISTS receivables;
DROP FUNCTION IF EXISTS validate_receivable_journal_line_links();
DROP FUNCTION IF EXISTS validate_receivable_settlement_line_links();
ALTER TABLE journal_lines DROP COLUMN IF EXISTS allocation;