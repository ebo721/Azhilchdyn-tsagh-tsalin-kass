---
name: Neon production migration sessions
description: Production migration and backup constraints for the external pooled Neon database.
---

Run production migration and rollback SQL only after setting `search_path` to `public` inside the same database session. Vercel production builds use the reviewed expand-only migration manifest, ledger checksums, schema fingerprint, and a build-scoped advisory lock.

**Why:** The pooled production connection can have no default current schema and rejects `search_path` as a startup option. App deployment and external Neon schema changes are separate unless the production build explicitly gates code compilation on migration success.

**How to apply:** New managed migrations must be backward-compatible expansions, transaction-free, listed in order in the production manifest, and accompanied by the updated schema fingerprint. Use manual atomic sessions only for rollbacks.