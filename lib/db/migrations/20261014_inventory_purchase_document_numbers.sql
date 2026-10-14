-- Expand: retain all purchases, quantities, payments and accounting links.
-- The migration runner executes this file in a transaction.
ALTER TABLE inventory_purchases
  ADD COLUMN IF NOT EXISTS document_number text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS inventory_purchase_document_counters (
  date date PRIMARY KEY,
  last_sequence integer NOT NULL,
  CONSTRAINT inventory_purchase_document_counters_sequence_check CHECK (last_sequence > 0)
);

-- Existing purchases receive stable daily numbers in original entry order.
WITH numbered AS (
  SELECT id, date,
    row_number() OVER (PARTITION BY date ORDER BY created_at, id)::integer AS sequence
  FROM inventory_purchases
)
UPDATE inventory_purchases AS purchase
SET document_number = to_char(numbered.date, 'YYYY/MM/DD') || '/' ||
  lpad(numbered.sequence::text, greatest(3, length(numbered.sequence::text)), '0')
FROM numbered
WHERE numbered.id = purchase.id AND purchase.document_number = '';

INSERT INTO inventory_purchase_document_counters (date, last_sequence)
SELECT date, max(split_part(document_number, '/', 4)::integer)
FROM inventory_purchases GROUP BY date
ON CONFLICT (date) DO UPDATE
SET last_sequence = greatest(inventory_purchase_document_counters.last_sequence, EXCLUDED.last_sequence);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_purchases_document_number_idx
  ON inventory_purchases (document_number);

CREATE OR REPLACE FUNCTION assign_inventory_purchase_document_number()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE next_sequence integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.date = OLD.date THEN
    -- Ordinary edits cannot overwrite or renumber an issued document.
    NEW.document_number := OLD.document_number;
    RETURN NEW;
  END IF;

  -- A single UPSERT serializes concurrent writers on the selected purchase date.
  -- Counter changes roll back with failed purchases; deletions never rewind it.
  INSERT INTO inventory_purchase_document_counters (date, last_sequence)
  VALUES (NEW.date, 1)
  ON CONFLICT (date) DO UPDATE
  SET last_sequence = inventory_purchase_document_counters.last_sequence + 1
  RETURNING last_sequence INTO next_sequence;

  NEW.document_number := to_char(NEW.date, 'YYYY/MM/DD') || '/' ||
    lpad(next_sequence::text, greatest(3, length(next_sequence::text)), '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_purchases_document_number_trigger ON inventory_purchases;
CREATE TRIGGER inventory_purchases_document_number_trigger
BEFORE INSERT OR UPDATE OF date, document_number ON inventory_purchases
FOR EACH ROW EXECUTE FUNCTION assign_inventory_purchase_document_number();
