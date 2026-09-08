---
name: Workspace-scoped packages
description: How to avoid accidental root dependencies when adding runtime packages in this pnpm workspace.
---

Do not accept a workspace-root install when a dependency belongs to one artifact. If the package installer cannot express a pnpm package filter, choose an approved package-scoped path or a dependency-free implementation instead.

**Why:** The managed Node package installer attempted a workspace-root install and rejected filter arguments, so retrying it would either fail or put server-only dependencies in the wrong package.

**How to apply:** Before adding a package, confirm the installer can target the owning workspace package. Keep runtime dependencies local to that artifact and clean up any unrelated toolchain files produced by failed installation attempts.