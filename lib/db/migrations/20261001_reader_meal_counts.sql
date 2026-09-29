CREATE TABLE IF NOT EXISTS meal_counts (
  id serial PRIMARY KEY,
  date date NOT NULL,
  meal_type text NOT NULL,
  normalized_meal_type text NOT NULL,
  count integer NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meal_counts_count_check CHECK (count >= 0),
  CONSTRAINT meal_counts_meal_type_check CHECK (meal_type <> '' AND normalized_meal_type <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS meal_counts_date_normalized_meal_type_idx
  ON meal_counts (date, normalized_meal_type);