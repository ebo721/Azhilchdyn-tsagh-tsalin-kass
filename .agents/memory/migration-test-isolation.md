---
name: Migration test isolation
description: Keep rollback DDL tests away from the public schema when the application or integration suites are running.
---

Exercise forward/rollback DDL in a temporary schema with fixture parent tables, not by dropping and recreating public tables inside a transaction.

**Why:** Even rolled-back public DDL can deadlock with ordinary bank/accounting requests: reads retain table locks, foreign-key recreation needs stronger parent locks, and another transaction may already be waiting on the dropped table.

**How to apply:** Test production-schema fingerprints read-only with `search_path = public`. Run structural constraint and rollback tests in an isolated schema, roll back the test transaction, and restore the public search path before comparing fingerprints; shadowed parent tables change `pg_get_constraintdef` output.
