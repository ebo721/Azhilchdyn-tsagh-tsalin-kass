---
name: Neon production migration sessions
description: Production migration and backup constraints for the external pooled Neon database.
---

Run production migration and rollback SQL only after setting `search_path` to `public` inside the same database session. Do not pass it through `PGOPTIONS` on the pooled endpoint. Use a PostgreSQL backup client at least as new as the server, or make and checksum explicit schema-qualified critical-table exports before a controlled additive migration.

**Why:** The pooled production connection can have no default current schema and rejects `search_path` as a startup option. The workspace backup client can also lag the Neon server major version, causing `pg_dump` to abort before producing an archive.

**How to apply:** Use one `psql` session that executes `SET search_path TO public` before including a migration or rollback file, and keep the migration atomic. Qualify preflight and backup reads with `public.`. Confirm client/server compatibility before relying on a full logical dump.