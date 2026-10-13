-- Manual recovery only. Dropping this table discards all recorded stock counts,
-- responsibility snapshots and their confirmation links. Preserve an export first;
-- do not run this script as part of a normal deployment rollback.
DROP TABLE IF EXISTS inventory_closing_balances;
