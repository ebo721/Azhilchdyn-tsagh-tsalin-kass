---
name: Vercel TypeScript emit
description: Why the API TypeScript configuration and imports must support real JavaScript emission on Vercel.
---

Keep the API TypeScript project compatible with actual JavaScript emission. Do not enable `allowImportingTsExtensions`, and use extensionless local imports in files included by the API tsconfig.

**Why:** Vercel performs an additional TypeScript emit after the custom esbuild bundle. An emit-incompatible tsconfig can fail only with `src/app.ts: Emit skipped`, hiding the underlying TS5096 diagnostic.

**How to apply:** After API TypeScript configuration or import changes, run a real emit to a temporary directory in addition to the normal no-emit typecheck and custom bundle build.