---
name: Production migration ordering
description: Append-only filename rule for the external Neon production migration ledger.
---

New production migrations must sort after every filename already applied in the external Neon ledger. Do not add a newly created migration with an earlier date merely because the feature began earlier.

**Why:** The production runner intentionally rejects a pending migration that appears before any already-applied migration. This prevents rewriting history, but a backdated feature migration will block the Vercel API build before any schema change is committed.

**How to apply:** Before release, compare new manifest filenames with the production ledger. If a new migration sorts earlier than an applied entry, rename both its forward and rollback files to the next append-only date/sequence, update the manifest, run migration parity tests, then run the protected production migration flow.