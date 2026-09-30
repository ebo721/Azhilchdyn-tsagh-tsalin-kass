-- Preserve old single meals as packed meals and move existing schedule selections
-- into a normalized, ordered many-to-many relation.
ALTER TABLE meals DROP CONSTRAINT meals_type_check;
UPDATE meals SET type = 'packed' WHERE type = 'single';
ALTER TABLE meals ADD CONSTRAINT meals_type_check
  CHECK (type IN ('set', 'packed', 'therapeutic'));

CREATE TABLE meal_schedule_entry_meals (
  id serial PRIMARY KEY,
  entry_id integer NOT NULL REFERENCES meal_schedule_entries(id) ON DELETE CASCADE,
  meal_id integer NOT NULL REFERENCES meals(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL
);
CREATE UNIQUE INDEX meal_schedule_entry_meals_entry_meal_idx ON meal_schedule_entry_meals(entry_id, meal_id);
CREATE UNIQUE INDEX meal_schedule_entry_meals_entry_order_idx ON meal_schedule_entry_meals(entry_id, sort_order);
CREATE INDEX meal_schedule_entry_meals_meal_idx ON meal_schedule_entry_meals(meal_id);

ALTER TABLE meal_schedule_entries ADD COLUMN meal_type text;
UPDATE meal_schedule_entries e SET meal_type = m.type
  FROM meals m WHERE e.meal_id = m.id;
INSERT INTO meal_schedule_entry_meals(entry_id, meal_id, sort_order)
  SELECT id, meal_id, 0 FROM meal_schedule_entries WHERE meal_id IS NOT NULL;
ALTER TABLE meal_schedule_entries DROP CONSTRAINT meal_schedule_entries_meal_check;
-- Leave the old column present but empty for a later contract migration, so
-- this release does not drop schedule data or a column used by older builds.
UPDATE meal_schedule_entries SET meal_id = NULL WHERE meal_id IS NOT NULL;
ALTER TABLE meal_schedule_entries ADD CONSTRAINT meal_schedule_entries_meal_check
  CHECK ((kind = 'meal' AND meal_type IN ('set', 'packed', 'therapeutic'))
    OR (kind = 'break' AND meal_type IS NULL));