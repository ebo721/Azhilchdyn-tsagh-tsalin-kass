ALTER TABLE office_attendance_punches
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

ALTER TABLE office_attendance_punches
  DROP CONSTRAINT IF EXISTS office_attendance_punches_cancellation_check;
ALTER TABLE office_attendance_punches
  ADD CONSTRAINT office_attendance_punches_cancellation_check
  CHECK (
    (cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL)
  );

DROP INDEX IF EXISTS office_attendance_punches_pending_employee_idx;
CREATE UNIQUE INDEX office_attendance_punches_pending_employee_idx
  ON office_attendance_punches(employee_id)
  WHERE checked_out_at IS NULL AND cancelled_at IS NULL;

CREATE OR REPLACE FUNCTION prevent_duplicate_attendance_employee_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- All writers serialize on the employee row, including legacy/manual SQL
  -- writers that do not acquire this lock in application code.
  PERFORM id FROM employees WHERE id = NEW.employee_id FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM attendance existing
    WHERE existing.employee_id = NEW.employee_id
      AND existing.date = NEW.date
      AND existing.id <> COALESCE(NEW.id, -1)
  ) THEN
    RAISE EXCEPTION 'Attendance already exists for employee % on %', NEW.employee_id, NEW.date
      USING ERRCODE = '23505', CONSTRAINT = 'attendance_employee_date_conflict';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS attendance_employee_date_conflict_trigger ON attendance;
CREATE TRIGGER attendance_employee_date_conflict_trigger
  BEFORE INSERT OR UPDATE OF employee_id, date ON attendance
  FOR EACH ROW
  EXECUTE FUNCTION prevent_duplicate_attendance_employee_date();