CREATE TABLE IF NOT EXISTS public.payroll_attendance_snapshots (
  month text PRIMARY KEY,
  payroll jsonb NOT NULL,
  advance jsonb NOT NULL,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_attendance_snapshots_month_check
    CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
