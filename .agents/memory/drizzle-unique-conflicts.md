---
name: Drizzle unique conflicts
description: How PostgreSQL uniqueness conflicts surface through the project's Drizzle runtime.
---

PostgreSQL unique-constraint violations may arrive as a Drizzle wrapper whose top-level error has no database code; the `23505` code is exposed on `error.cause.code`.

**Why:** Concurrent financial-link requests correctly triggered the database constraint but were returned as HTTP 500 until the nested cause was inspected.

**How to apply:** When mapping expected uniqueness conflicts to HTTP 409, check both `error.code` and `error.cause.code`; keep the database unique constraint as the final concurrency guard.