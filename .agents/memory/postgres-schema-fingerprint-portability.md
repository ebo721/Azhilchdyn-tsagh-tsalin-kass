---
name: PostgreSQL schema fingerprint portability
description: Avoid false managed-schema drift when comparing PostgreSQL catalogs across server versions.
---

When fingerprinting new tables from PostgreSQL catalogs, capture column nullability from `information_schema.columns` and do not additionally fingerprint `pg_constraint` entries of type `n` (NOT NULL).

**Why:** Newer PostgreSQL versions expose NOT NULL constraints as separate catalog rows while older versions do not. A signature including both representations differs even if the migration created the same schema.

**How to apply:** If a managed-schema fingerprint changes unexpectedly across environments, compare catalog query results before updating a manifest hash. Exclude duplicate NOT NULL constraints from new signature queries, then verify the resulting signature against the target development database and keep all other check/FK/index definitions covered.