---
name: Vercel TypeScript emit
description: Why the API TypeScript configuration and imports must support real JavaScript emission on Vercel.
---

Keep the API TypeScript project compatible with actual JavaScript emission. Do not enable `allowImportingTsExtensions`, use extensionless local imports, and keep the API-level `noEmitOnError: false` override.

**Why:** Vercel performs an additional per-file TypeScript emit after the strict typecheck and custom esbuild bundle. An emit-incompatible config or workspace diagnostic can surface only as `<source file>: Emit skipped`, hiding the underlying diagnostic.

**How to apply:** Keep strict checking in the existing typecheck step. After API TypeScript configuration or import changes, also run a real emit to a temporary directory and the custom bundle build.