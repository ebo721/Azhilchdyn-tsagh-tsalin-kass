ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS allocation jsonb;

CREATE TABLE IF NOT EXISTS receivables (
  id serial PRIMARY KEY,
  origin_journal_entry_id integer NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  origin_journal_line_id integer NOT NULL REFERENCES journal_lines(id) ON DELETE RESTRICT,
  employee_id integer REFERENCES employees(id) ON DELETE RESTRICT,
  supplier_id integer REFERENCES inventory_suppliers(id) ON DELETE RESTRICT,
  original_amount numeric(14,2) NOT NULL,
  open_amount numeric(14,2) NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receivables_exactly_one_party_check CHECK (((employee_id IS NOT NULL)::integer + (supplier_id IS NOT NULL)::integer) = 1),
  CONSTRAINT receivables_amounts_check CHECK (original_amount > 0 AND open_amount >= 0 AND open_amount <= original_amount),
  CONSTRAINT receivables_status_balance_check CHECK ((status = 'open' AND open_amount > 0) OR (status = 'settled' AND open_amount = 0)),
  CONSTRAINT receivables_status_check CHECK (status IN ('open','settled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS receivables_origin_line_idx ON receivables(origin_journal_line_id);
CREATE INDEX IF NOT EXISTS receivables_open_idx ON receivables(status, open_amount);

CREATE TABLE IF NOT EXISTS receivable_allocations (
  id serial PRIMARY KEY,
  receivable_id integer NOT NULL REFERENCES receivables(id) ON DELETE RESTRICT,
  settlement_journal_entry_id integer NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  settlement_journal_line_id integer NOT NULL REFERENCES journal_lines(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS receivable_allocations_settlement_line_idx ON receivable_allocations(settlement_journal_line_id);
CREATE INDEX IF NOT EXISTS receivable_allocations_receivable_idx ON receivable_allocations(receivable_id);

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
DROP TRIGGER IF EXISTS receivables_journal_line_parent_trigger ON receivables;
CREATE CONSTRAINT TRIGGER receivables_journal_line_parent_trigger
AFTER INSERT OR UPDATE ON receivables DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_receivable_journal_line_links();
DROP TRIGGER IF EXISTS receivable_allocations_journal_line_parent_trigger ON receivable_allocations;
CREATE CONSTRAINT TRIGGER receivable_allocations_journal_line_parent_trigger
AFTER INSERT OR UPDATE ON receivable_allocations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_receivable_settlement_line_links();