# Multiple payroll payments: release notes

The forward SQL adds an empty JSON array. It does not rewrite the first two
payments, bank links, cash IDs, source keys, journals or saved balances.
New callers send `additionalPayments`; old callers omitting it preserve it.
Each sequence has a stable payroll cash source key and must never be renumbered.

## Production gate

This branch is for review only. Do not merge/release or run production SQL
without the owner's approval. Show the forward SQL and rollback guard before
requesting migration approval. Apply through the reviewed migration runner,
which verifies the schema fingerprint.

The column itself is additive, but after anyone saves a third payment **an old
API build is no longer a safe rollback target**: it would omit that payment from
payroll totals. Drain the old API before enabling new writes. For a later code
rollback, keep an API that understands additional payments. The rollback SQL
refuses to drop the column if it contains any payments; never bypass that guard.

The existing balance invalidation and closed-payroll triggers apply to all
adjustment updates, including the additional array. No historical attendance
or saved calculation is pulled by this migration.
