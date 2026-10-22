---
name: Stacked PR merge visibility
description: How to verify integration of stacked review branches in this project.
---

When reviewing a chain of pull requests, check each PR's target branch and compare the final feature tree against the current main tree. A "merged" label proves only that the PR entered its target branch, not that the full chain reached main.

**Why:** A reviewed chain merged its first PR into main and the remaining PRs into intermediate feature branches. All appeared merged in GitHub, but the final UI and API changes were still absent from main.

**How to apply:** Before reporting a feature as shipped or ready for production, verify the exact files or tree on main. Do not treat a closed/merged PR list as evidence of deployment.

Prefer `main` as the target for new review PRs. Express dependencies in the description rather than targeting an intermediate feature branch unless a stacked review is specifically necessary; if stacking is necessary, retarget the child PR after its parent reaches main and before merging it.

**Why:** Intermediate-target merges have repeatedly left reviewed changes outside the production branch, confusing users who see GitHub's “Merged” status.

**How to apply:** Check the base branch before creating or recommending a merge. A corrective main-targeted PR is safer than directly merging or publishing on the user's behalf.