---
name: Vercel TypeScript emit
description: Why the API TypeScript configuration and imports must support real JavaScript emission on Vercel.
---

Keep the API TypeScript project compatible with actual JavaScript emission. Do not enable `allowImportingTsExtensions`, use extensionless local imports, and keep the API-level `noEmitOnError: false` override.

**Why:** Vercel performs an additional per-file TypeScript emit after the strict typecheck and custom esbuild bundle. An emit-incompatible config or workspace diagnostic can surface only as `<source file>: Emit skipped`, hiding the underlying diagnostic.

**How to apply:** Keep strict checking in the existing typecheck step. After API TypeScript configuration or import changes, also run a real emit to a temporary directory and the custom bundle build.

When server routes use Node's global `fetch`, keep the Fetch `Response` interface visible to the API TypeScript project rather than relying on whichever ambient Node types the build environment happens to load.

**Why:** A Vercel build reported missing `Response.ok` and `Response.json` even though the same source passed the local typecheck and custom bundle build. The hosted preview passed once the API's TypeScript libraries included DOM Fetch types; this was a build-type mismatch, not a route or runtime change.

**How to apply:** For Vercel-only `Response` property errors, check the API's TypeScript `lib` setting and confirm the hosted preview build after any fix; a local typecheck alone does not prove this case is resolved.