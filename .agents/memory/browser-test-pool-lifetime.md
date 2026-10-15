---
name: Browser test database pool lifetime
description: Individually passing database-backed Playwright specs can fail together when suite teardown closes a worker-shared pool.
---

Run the current database-backed browser specs in separate test-process invocations unless database teardown has been moved to a worker-scoped lifecycle.

**Why:** A suite-local teardown closed a process-shared database pool. The next spec in the same Playwright worker could neither create its fixtures nor close the already-ended pool, even though each spec passed alone.

**How to apply:** Distinguish test-runner resource lifetime failures from application failures. Preserve fixture cleanup and real database assertions. A future suite-wide refactor should own the pool once per worker instead of closing it after each file.
