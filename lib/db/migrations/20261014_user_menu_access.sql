-- Expand: NULL retains the legacy role's default navigation and API access.
-- An explicit array restricts this user without increasing role permissions.
ALTER TABLE users ADD COLUMN IF NOT EXISTS menu_paths text[];
