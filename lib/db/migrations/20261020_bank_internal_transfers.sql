-- Expand only: no existing transaction types, balances or journals change.
CREATE TABLE public.bank_internal_transfers (
  id serial PRIMARY KEY,
  out_bank_transaction_id integer NOT NULL UNIQUE REFERENCES public.bank_transactions(id) ON DELETE RESTRICT,
  in_bank_transaction_id integer NOT NULL UNIQUE REFERENCES public.bank_transactions(id) ON DELETE RESTRICT,
  fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_internal_transfers_fee_check CHECK (fee_amount >= 0),
  CONSTRAINT bank_internal_transfers_distinct_check CHECK (out_bank_transaction_id <> in_bank_transaction_id)
);
