DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE full_name IS NOT NULL)
    OR EXISTS (SELECT 1 FROM inventory_purchases WHERE responsible_user_id IS NOT NULL OR responsible_name IS NOT NULL)
    OR EXISTS (SELECT 1 FROM inventory_issues WHERE responsible_user_id IS NOT NULL OR responsible_name IS NOT NULL) THEN
    RAISE EXCEPTION 'Refusing rollback: custodian names are populated';
  END IF;
END $$;
ALTER TABLE inventory_issues DROP COLUMN responsible_user_id, DROP COLUMN responsible_name;
ALTER TABLE inventory_purchases DROP COLUMN responsible_user_id, DROP COLUMN responsible_name;
ALTER TABLE users DROP COLUMN full_name;
