---
name: Git and hosting boundaries
description: Security and configuration boundaries for GitHub, Replit, and Vercel workflows.
---

Never push database dump or backup files to GitHub. Keep Replit runtime configuration separate from Vercel deployment configuration rather than trying to make one platform consume the other's files.

Production releases use GitHub to trigger Vercel, while production schema changes target the Vercel-connected Neon database through explicit, reviewed migration steps. Do not assume Replit Publish manages production.

Before any destructive production SQL, show the exact SQL, explain its impact and rollback, and wait for the user's explicit approval to run it. A deploy approval or successful deployment is not approval for a database change.

**Why:** Database dumps can contain password hashes, financial records, and other production data. Vercel does not read `.replit`, and Replit's development database is separate from the production Neon database. A production `DROP COLUMN` was previously run after deploy validation without the required explicit database approval.

**How to apply:** Before pushing, verify dumps and backups are excluded from Git history. Validate development and Neon production separately, use reversible migrations, then push GitHub to trigger Vercel. Stop at a production migration gate until the user explicitly approves the displayed SQL.

In this workspace, the connected GitHub integration can make repository API calls even when `git push` and `gh` have no usable authentication. If a review branch is published through the GitHub Git Trees/Commits/Refs API, its remote commit can differ from the equivalent local commit despite identical files.

**Why:** Git's credential helper rejected a branch push, while the connected integration successfully created the review branch and pull request. Assuming the local branch tracks that remote commit would make later updates confusing.

**How to apply:** Before extending a branch published via the API, compare the local and remote refs/trees and base the next remote commit on the actual remote head. Never ask for or expose the integration's token to work around Git authentication.

When passing filenames from the CodeExecution shell callback into filesystem operations, trim each line, including carriage returns.

**Why:** Its command output can contain CRLF line endings; an untrimmed `git diff --name-only` path looks valid in logs but fails to open with `ENOENT`.

**How to apply:** Split filename lists on `\r?\n`, trim each entry, and discard blanks before reading or uploading branch files.

If the checkout's HTTPS remote rejects its stored GitHub credential, use the connected GitHub integration to create one atomic commit with an expected-head guard instead of force-pushing or writing files as separate commits.

**Why:** The workspace remote credential can be stale even when the GitHub integration is healthy; an expected-head atomic commit prevents overwriting concurrent changes or briefly deploying a partial update.

**How to apply:** Require the remote `main` head to equal the local commit's parent, commit all changed files together, then sync local `main` only after confirming the remote and local trees are identical.

For a PR that must preserve existing commit history, check whether GitHub already has the desired commit objects through another pushed branch. If it does, create a new branch reference to the exact full commit SHA using the connected GitHub API, then open the PR from that branch; do not recreate or squash the commits.

**Why:** A stale Git CLI credential does not prevent another workspace workflow from uploading the same ancestry, and GitHub can reuse uploaded objects without rewriting history.

**How to apply:** Verify the full commit SHA through the GitHub API, compare it with the intended base to confirm commit count and files, and create the branch reference only when it does not already exist. Confirm the resulting PR excludes later work.

Once a PR is merged, later commits to its source branch are not included in that merge and do not reach production. Treat follow-on fixes as a new branch from current `main`, a new PR, and a separate release check.

**Why:** A merged feature PR had further fixes pushed to its source branch afterward. Vercel successfully deployed the merge, but the fixes remained absent from `main` and production.

**How to apply:** Check the PR's merged state and exact merged head SHA before explaining a production discrepancy. If the source branch contains newer commits, cherry-pick the intended fixes onto current `main` in a fresh review branch rather than reusing the closed PR.

For a database change that replaces values or removes an old API's expected source of truth, treat rollout as a contract migration rather than labeling it expand. Block automatic production application until the old API is drained, an old-build rollback is ruled out, and production SQL receives separate approval.

**Why:** An older meal API expects `single` and a single schedule meal reference; converting those while it is still serving requests would break reads and writes even though the new schema retains the old column.

**How to apply:** Review backward compatibility against the still-running build, not just the new build. Gate any pending contract migration in the release path; a feature PR can be reviewed as draft, but merging or publishing must wait for a coordinated cutover.

Treat an execution-worker disconnect during GitHub publication as an unknown outcome, not proof that the repository update failed.

**Why:** A multi-step publication can lose its tool response after an external write, leaving no reliable confirmation of which steps completed.

**How to apply:** Before retrying, compare the remote head and tree with the intended local commit. If they already match, report success without another write; otherwise retain the expected-parent guard. Do not claim the live version changed without confirmation.

When recreating a local commit through GitHub's Git Commits API, preserve its trailing message newline as well as its tree, parent, author, committer, and timestamps.

**Why:** The API preserves the message verbatim, whereas ordinary Git commits end the message with a newline. Omitting it produces a different commit SHA even when all files and metadata match; retaining it allowed the remote commit to match the local commit exactly.

**How to apply:** Use the original message without trimming its final newline when exact commit identity matters. Still verify the resulting tree and expected remote head before updating the branch.