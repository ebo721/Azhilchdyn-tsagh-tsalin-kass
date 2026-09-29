---
name: Integration test workspace exports
description: Avoid stale runtime JS in API integration tests after changing generated contracts.
---

When integration tests use tsx immediately after OpenAPI codegen and library typechecking, run them with `NODE_OPTIONS='--conditions=workspace'`.

**Why:** Typechecking refreshes declarations but does not necessarily refresh the compiled runtime JS that Node's default package export resolves. A newly added request variant passed TypeScript and appeared in generated source, yet the route's runtime Zod validator still used the earlier three-branch union, causing misleading validation errors until tests used the workspace export.

**How to apply:** For source-driven integration tests after contract changes, use the workspace condition, or rebuild the API runtime before running without it. Do not infer a schema error from a mismatch between fresh generated types and stale default-export JS.