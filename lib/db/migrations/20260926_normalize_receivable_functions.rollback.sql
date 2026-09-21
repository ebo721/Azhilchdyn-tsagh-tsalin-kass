CREATE OR REPLACE FUNCTION validate_receivable_journal_line_links()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE origin_parent integer;
DECLARE settlement_parent integer;
BEGIN
  SELECT journal_entry_id INTO origin_parent FROM journal_lines WHERE id = NEW.origin_journal_line_id;
  IF origin_parent IS DISTINCT FROM NEW.origin_journal_entry_id THEN
    RAISE EXCEPTION 'Receivable origin line does not belong to origin journal entry';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION validate_receivable_settlement_line_links()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settlement_parent integer;
BEGIN
  SELECT journal_entry_id INTO settlement_parent FROM journal_lines WHERE id = NEW.settlement_journal_line_id;
  IF settlement_parent IS DISTINCT FROM NEW.settlement_journal_entry_id THEN
    RAISE EXCEPTION 'Receivable settlement line does not belong to settlement journal entry';
  END IF;
  RETURN NEW;
END $$;