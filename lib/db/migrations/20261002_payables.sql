CREATE TABLE IF NOT EXISTS payables (
  id serial PRIMARY KEY,
  party_type text NOT NULL,
  party_id integer NOT NULL,
  original_amount numeric(14,2) NOT NULL,
  remaining_balance numeric(14,2) NOT NULL,
  status text NOT NULL DEFAULT 'open',
  journal_entry_id integer NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payables_party_type_check CHECK (party_type IN ('employee', 'supplier')),
  CONSTRAINT payables_party_id_check CHECK (party_id > 0),
  CONSTRAINT payables_amounts_check CHECK (original_amount > 0 AND remaining_balance >= 0 AND remaining_balance <= original_amount),
  CONSTRAINT payables_status_balance_check CHECK ((status = 'open' AND remaining_balance > 0) OR (status = 'closed' AND remaining_balance = 0)),
  CONSTRAINT payables_status_check CHECK (status IN ('open', 'closed'))
);
CREATE INDEX IF NOT EXISTS payables_party_status_idx ON payables(party_type, party_id, status);
CREATE INDEX IF NOT EXISTS payables_journal_entry_idx ON payables(journal_entry_id);

CREATE TABLE IF NOT EXISTS payable_allocations (
  id serial PRIMARY KEY,
  payable_id integer NOT NULL REFERENCES payables(id) ON DELETE RESTRICT,
  settlement_journal_entry_id integer NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  settlement_journal_line_id integer NOT NULL REFERENCES journal_lines(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payable_allocations_amount_check CHECK (amount > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS payable_allocations_settlement_line_idx ON payable_allocations(settlement_journal_line_id);
CREATE INDEX IF NOT EXISTS payable_allocations_payable_idx ON payable_allocations(payable_id);

-- A polymorphic party_type/party_id cannot use a normal foreign key.
-- Lock the referenced row like a foreign key and restrict deleting an in-use party.
CREATE FUNCTION validate_payable_party()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.party_type = 'employee' THEN
    PERFORM 1 FROM employees WHERE id = NEW.party_id FOR KEY SHARE;
  ELSIF NEW.party_type = 'supplier' THEN
    PERFORM 1 FROM inventory_suppliers WHERE id = NEW.party_id FOR KEY SHARE;
  ELSE
    RAISE EXCEPTION 'Unsupported payable party type' USING ERRCODE = '23514';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payable party does not exist' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payables_party_trigger
BEFORE INSERT OR UPDATE OF party_type, party_id ON payables
FOR EACH ROW EXECUTE FUNCTION validate_payable_party();

CREATE FUNCTION restrict_payable_party_removal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.id = OLD.id THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM payables
    WHERE party_type = TG_ARGV[0] AND party_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Party has payables' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER payables_employee_restrict_trigger
BEFORE DELETE OR UPDATE OF id ON employees
FOR EACH ROW EXECUTE FUNCTION restrict_payable_party_removal('employee');
CREATE TRIGGER payables_supplier_restrict_trigger
BEFORE DELETE OR UPDATE OF id ON inventory_suppliers
FOR EACH ROW EXECUTE FUNCTION restrict_payable_party_removal('supplier');

CREATE FUNCTION validate_payable_settlement_line_links()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settlement_parent integer;
BEGIN
  SELECT journal_entry_id INTO settlement_parent FROM journal_lines WHERE id = NEW.settlement_journal_line_id;
  IF settlement_parent IS DISTINCT FROM NEW.settlement_journal_entry_id THEN
    RAISE EXCEPTION 'Payable settlement line does not belong to settlement journal entry';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER payable_allocations_journal_line_parent_trigger
AFTER INSERT OR UPDATE ON payable_allocations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_payable_settlement_line_links();