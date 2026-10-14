-- DESTRUCTIVE: removes saved per-user restrictions. Old code falls back to roles.
-- Back up menu_paths and coordinate an old-code rollback before executing.
ALTER TABLE users DROP COLUMN IF EXISTS menu_paths;
