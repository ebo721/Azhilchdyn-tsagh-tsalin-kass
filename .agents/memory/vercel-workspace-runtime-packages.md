---
name: Vercel workspace runtime packages
description: How internal TypeScript workspace libraries must be packaged for Vercel zero-config Node functions.
---

Keep internal workspace libraries source-based for development and type checking, but expose compiled JavaScript as their default runtime export. The API build must generate both project-reference declarations and runtime JavaScript before Vercel traces the Function.

**Why:** Vercel zero-config transpiles the Express source without application bundling. A workspace package whose runtime export points at TypeScript source can be copied as a broken symlink or omitted, causing `ERR_MODULE_NOT_FOUND`; generating only JavaScript also breaks local project references with TS6305.

**How to apply:** Use a workspace/types export condition for TypeScript source and a default export to runtime `dist` JavaScript. Build declarations first, then generate runtime library bundles before the API bundle.