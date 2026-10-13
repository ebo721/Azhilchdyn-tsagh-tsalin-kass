ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE inventory_purchases ADD COLUMN IF NOT EXISTS responsible_user_id integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE inventory_purchases ADD COLUMN IF NOT EXISTS responsible_name text;
ALTER TABLE inventory_issues ADD COLUMN IF NOT EXISTS responsible_user_id integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE inventory_issues ADD COLUMN IF NOT EXISTS responsible_name text;
