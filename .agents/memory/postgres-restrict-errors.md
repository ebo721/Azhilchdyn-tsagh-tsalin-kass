---
name: PostgreSQL RESTRICT errors
description: Foreign-key delete conflict codes for restricted relations.
---

PostgreSQL `ON DELETE RESTRICT` can raise SQLSTATE `23001` (`restrict_violation`), not only `23503` (`foreign_key_violation`). For a user-facing deletion conflict, handle both codes and inspect wrapped driver errors through their cause chain.

**Why:** A meal referenced by a schedule returned HTTP 500 when the deletion handler checked only `23503`; a focused integration test showed the actual driver code was `23001`.

**How to apply:** When a delete may encounter restricted references, test against a referenced row and map both codes to a clear conflict response while leaving approval state unchanged.