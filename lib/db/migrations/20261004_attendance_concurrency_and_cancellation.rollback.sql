DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM office_attendance_punches WHERE cancelled_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Attendance punch cancellations exist; archive their audit data before rollback';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS attendance_employee_date_conflict_trigger ON attendance;
DROP FUNCTION IF EXISTS prevent_duplicate_attendance_employee_date();

DROP INDEX IF EXISTS office_attendance_punches_pending_employee_idx;
CREATE UNIQUE INDEX office_attendance_punches_pending_employee_idx
  ON office_attendance_punches(employee_id)
  WHERE checked_out_at IS NULL;

ALTER TABLE office_attendance_punches
  DROP CONSTRAINT IF EXISTS office_attendance_punches_cancellation_check;
ALTER TABLE office_attendance_punches
  DROP COLUMN IF EXISTS cancelled_by,
  DROP COLUMN IF EXISTS cancellation_reason,
  DROP COLUMN IF EXISTS cancelled_at;