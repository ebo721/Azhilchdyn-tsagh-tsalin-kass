CREATE TABLE IF NOT EXISTS office_attendance_network (
  id integer PRIMARY KEY,
  office_ip text NOT NULL,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT office_attendance_network_singleton_check CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS attendance_device_enrollments (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS attendance_device_enrollments_employee_idx
  ON attendance_device_enrollments(employee_id);

CREATE TABLE IF NOT EXISTS attendance_devices (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  public_key jsonb NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS attendance_devices_employee_idx ON attendance_devices(employee_id);

CREATE TABLE IF NOT EXISTS office_attendance_punches (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  device_id integer NOT NULL REFERENCES attendance_devices(id) ON DELETE RESTRICT,
  office_date date NOT NULL,
  checked_in_at timestamptz NOT NULL,
  checked_out_at timestamptz,
  attendance_id integer REFERENCES attendance(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS office_attendance_punches_employee_date_idx
  ON office_attendance_punches(employee_id, office_date);
CREATE UNIQUE INDEX IF NOT EXISTS office_attendance_punches_pending_employee_idx
  ON office_attendance_punches(employee_id) WHERE checked_out_at IS NULL;

CREATE TABLE IF NOT EXISTS office_attendance_nonces (
  id serial PRIMARY KEY,
  device_id integer NOT NULL REFERENCES attendance_devices(id) ON DELETE CASCADE,
  nonce_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT office_attendance_nonces_device_nonce_idx UNIQUE (device_id, nonce_hash)
);