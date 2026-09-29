---
name: Remote DB reconciliation latency
description: Why SQL execution plans alone missed the operating-expense list delay.
---

Read-side reconciliation over a remote database must avoid serial per-row SQL calls even when each indexed query has a fast execution plan. Batch the state needed to identify already-current pairs; preserve the existing locked reconciliation for pairs that actually need a write.

**Why:** A list request exceeded its browser timeout despite sub-millisecond query plans. Most linked rows were system-generated and required no work, but the old loop still made locking queries for each one. Remote round-trip latency, not a slow scan, dominated the request.

**How to apply:** Measure wall-clock request and round-trip time alongside `EXPLAIN ANALYZE`. Exclude no-op sources before row locks, read comparison state in batches, and retain a targeted write path for stale or missing mirrors.