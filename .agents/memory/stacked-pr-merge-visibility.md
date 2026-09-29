---
name: Stacked PR merge visibility
description: How to verify integration of stacked review branches in this project.
---

When reviewing a chain of pull requests, check each PR's target branch and compare the final feature tree against the current main tree. A "merged" label proves only that the PR entered its target branch, not that the full chain reached main.

**Why:** A reviewed chain merged its first PR into main and the remaining PRs into intermediate feature branches. All appeared merged in GitHub, but the final UI and API changes were still absent from main.

**How to apply:** Before reporting a feature as shipped or ready for production, verify the exact files or tree on main. Do not treat a closed/merged PR list as evidence of deployment.