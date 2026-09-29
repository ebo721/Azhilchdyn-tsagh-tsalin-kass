CREATE TABLE inventory_purchase_payment_groups (
  id serial PRIMARY KEY,
  bank_transaction_id integer NOT NULL,
  cash_transaction_id integer REFERENCES cash_transactions(id) ON DELETE SET NULL,
  journal_entry_id integer NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT inventory_purchase_payment_groups_status_check CHECK (status IN ('active', 'cancelled')),
  CONSTRAINT inventory_purchase_payment_groups_cancelled_check CHECK (
    (status = 'active' AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
  )
);
CREATE INDEX inventory_purchase_payment_groups_bank_idx
  ON inventory_purchase_payment_groups(bank_transaction_id);

CREATE TABLE inventory_purchase_payment_group_members (
  group_id integer NOT NULL REFERENCES inventory_purchase_payment_groups(id) ON DELETE CASCADE,
  purchase_id integer NOT NULL
);
CREATE INDEX inventory_purchase_payment_group_members_purchase_idx
  ON inventory_purchase_payment_group_members(purchase_id);
CREATE INDEX inventory_purchase_payment_group_members_group_idx
  ON inventory_purchase_payment_group_members(group_id);
CREATE UNIQUE INDEX inventory_purchase_payment_group_members_group_purchase_idx
  ON inventory_purchase_payment_group_members(group_id, purchase_id);