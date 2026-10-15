---
name: Route contract and authorization boundaries
description: Guard against generated-client route drift and Express path variants bypassing role checks.
---

For new client-driven mutations, verify the generated request URL against the actual server route, not just types and isolated route tests. Put sensitive role checks at the handler boundary even when a global middleware also checks a path.

**Why:** A generated client used a different POST path from the tested server route while all typechecks and server integration tests passed. Separately, Express accepted a trailing slash that missed an exact-path role check in middleware.

**How to apply:** After codegen, check the concrete generated URL and exercise a request through it. For privileged mutations, test equivalent route variants (especially trailing slashes) with a forbidden role and enforce authorization inside the handler.

Read-only page dependencies must pass both the selected-menu gate and the underlying role gate. Test with a real account restricted to that page, not only with an administrator or an isolated menu predicate.

**Why:** Bank-only menu checks passed while the accountant's separate role gate still blocked purchase lists. The UI previously presented the resulting lookup failure as an empty list, concealing the authorization defect.

**How to apply:** Share the exact lookup allowlist between authorization layers, preserve source mutation/detail restrictions, and show lookup failures explicitly with retry. Exercise the authenticated UI and verify forbidden source writes still return 403.