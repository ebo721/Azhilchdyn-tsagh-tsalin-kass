ALTER TABLE journal_lines
  DROP CONSTRAINT IF EXISTS journal_lines_one_side_check,
  DROP CONSTRAINT IF EXISTS journal_lines_one_sided_check;

ALTER TABLE journal_lines
  ADD CONSTRAINT journal_lines_one_sided_check
  CHECK (
    (debit > 0 AND credit = 0)
    OR (credit > 0 AND debit = 0)
  );