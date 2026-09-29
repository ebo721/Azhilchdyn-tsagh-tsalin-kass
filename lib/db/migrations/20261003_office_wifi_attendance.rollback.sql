DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM office_attendance_nonces)
    OR EXISTS (SELECT 1 FROM office_attendance_punches)
    OR EXISTS (SELECT 1 FROM attendance_devices)
    OR EXISTS (SELECT 1 FROM attendance_device_enrollments)
    OR EXISTS (SELECT 1 FROM office_attendance_network)
  THEN
    RAISE EXCEPTION 'Office attendance data exists; export/archive it before rollback';
  END IF;
END
$$;

DROP TABLE office_attendance_nonces;
DROP TABLE office_attendance_punches;
DROP TABLE attendance_devices;
DROP TABLE attendance_device_enrollments;
DROP TABLE office_attendance_network;