CREATE TABLE IF NOT EXISTS meal_edit_requests (
  id serial PRIMARY KEY,
  meal_id integer NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  requester_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_name text NOT NULL,
  previous_category text NOT NULL,
  proposed_name text NOT NULL,
  proposed_category text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  approved_by integer REFERENCES users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CONSTRAINT meal_edit_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
);
CREATE UNIQUE INDEX IF NOT EXISTS meal_edit_requests_pending_meal_idx
  ON meal_edit_requests (meal_id) WHERE status = 'pending';