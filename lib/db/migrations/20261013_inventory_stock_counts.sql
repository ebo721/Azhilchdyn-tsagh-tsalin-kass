CREATE TABLE IF NOT EXISTS inventory_closing_balances (
  id serial PRIMARY KEY,
  inventory_item_id integer NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  date date NOT NULL,
  quantity numeric(14,3) NOT NULL,
  book_quantity numeric(14,3) NOT NULL,
  unit_price numeric(14,2) NOT NULL,
  price_source text NOT NULL,
  responsible_employee_id integer REFERENCES employees(id) ON DELETE SET NULL,
  responsible_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  responsible_name text NOT NULL,
  issue_id integer REFERENCES inventory_issues(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  approved_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_closing_balances_values_check CHECK (quantity >= 0 AND book_quantity >= 0 AND unit_price >= 0),
  CONSTRAINT inventory_closing_balances_price_source_check CHECK (price_source IN ('purchase', 'opening'))
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_closing_balances_item_date_idx ON inventory_closing_balances(inventory_item_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_closing_balances_issue_idx ON inventory_closing_balances(issue_id);
