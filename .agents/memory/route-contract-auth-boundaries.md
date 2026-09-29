---
name: Route contract and authorization boundaries
description: Guard against generated-client route drift and Express path variants bypassing role checks.
---

For new client-driven mutations, verify the generated request URL against the actual server route, not just types and isolated route tests. Put sensitive role checks at the handler boundary even when a global middleware also checks a path.

**Why:** A generated client used a different POST path from the tested server route while all typechecks and server integration tests passed. Separately, Express accepted a trailing slash that missed an exact-path role check in middleware.

**How to apply:** After codegen, check the concrete generated URL and exercise a request through it. For privileged mutations, test equivalent route variants (especially trailing slashes) with a forbidden role and enforce authorization inside the handler.