-- A legacy one-meal cell cannot represent multi-meal or therapeutic cells.
BEGIN;
LOCK TABLE meals, meal_schedule_entries, meal_schedule_entry_meals IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM meals WHERE type = 'therapeutic')
    OR EXISTS (SELECT 1 FROM meal_schedule_entries WHERE kind = 'meal' AND meal_type = 'therapeutic')
    OR EXISTS (SELECT entry_id FROM meal_schedule_entry_meals GROUP BY entry_id HAVING count(*) <> 1)
    OR EXISTS (SELECT 1 FROM meal_schedule_entries e WHERE e.kind = 'meal'
      AND NOT EXISTS (SELECT 1 FROM meal_schedule_entry_meals em WHERE em.entry_id = e.id)) THEN
    RAISE EXCEPTION 'Cannot roll back multi-meal schedules without losing data';
  END IF;
END $$;

UPDATE meal_schedule_entries e SET meal_id = em.meal_id
  FROM meal_schedule_entry_meals em WHERE em.entry_id = e.id;
ALTER TABLE meal_schedule_entries DROP CONSTRAINT meal_schedule_entries_meal_check;
ALTER TABLE meal_schedule_entries ADD CONSTRAINT meal_schedule_entries_meal_check
  CHECK ((kind = 'meal' AND meal_id IS NOT NULL) OR (kind = 'break' AND meal_id IS NULL));
ALTER TABLE meal_schedule_entries DROP COLUMN meal_type;
DROP TABLE meal_schedule_entry_meals;
ALTER TABLE meals DROP CONSTRAINT meals_type_check;
UPDATE meals SET type = 'single' WHERE type = 'packed';
ALTER TABLE meals ADD CONSTRAINT meals_type_check CHECK (type IN ('single', 'set'));
COMMIT;