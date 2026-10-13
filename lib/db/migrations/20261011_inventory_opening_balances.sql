CREATE TABLE IF NOT EXISTS public.inventory_opening_balances (
  id serial PRIMARY KEY,
  inventory_item_id integer NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  date date NOT NULL,
  quantity numeric(12,3) NOT NULL,
  remaining_quantity numeric(12,3) NOT NULL,
  unit_price numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_opening_balances_quantity_check CHECK (quantity > 0 AND remaining_quantity >= 0 AND remaining_quantity <= quantity),
  CONSTRAINT inventory_opening_balances_price_check CHECK (unit_price >= 0)
);
CREATE INDEX IF NOT EXISTS inventory_opening_balances_item_idx ON public.inventory_opening_balances(inventory_item_id);

CREATE TABLE IF NOT EXISTS public.inventory_opening_consumptions (
  id serial PRIMARY KEY,
  issue_id integer NOT NULL REFERENCES public.inventory_issues(id) ON DELETE CASCADE,
  opening_balance_id integer NOT NULL REFERENCES public.inventory_opening_balances(id) ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL,
  unit_price numeric(14,2) NOT NULL,
  CONSTRAINT inventory_opening_consumptions_quantity_check CHECK (quantity > 0),
  CONSTRAINT inventory_opening_consumptions_price_check CHECK (unit_price >= 0)
);
CREATE INDEX IF NOT EXISTS inventory_opening_consumptions_issue_idx ON public.inventory_opening_consumptions(issue_id);
CREATE INDEX IF NOT EXISTS inventory_opening_consumptions_balance_idx ON public.inventory_opening_consumptions(opening_balance_id);
