---
name: Git and hosting boundaries
description: Security and configuration boundaries for GitHub, Replit, and Vercel workflows.
---

Never push database dump or backup files to GitHub. Keep Replit runtime configuration separate from Vercel deployment configuration rather than trying to make one platform consume the other's files.

Production releases use GitHub to trigger Vercel, while production schema changes target the Vercel-connected Neon database through explicit, reviewed migration steps. Do not assume Replit Publish manages production.

Before any destructive production SQL, show the exact SQL, explain its impact and rollback, and wait for the user's explicit approval to run it. A deploy approval or successful deployment is not approval for a database change.

**Why:** Database dumps can contain password hashes, financial records, and other production data. Vercel does not read `.replit`, and Replit's development database is separate from the production Neon database. A production `DROP COLUMN` was previously run after deploy validation without the required explicit database approval.

**How to apply:** Before pushing, verify dumps and backups are excluded from Git history. Validate development and Neon production separately, use reversible migrations, then push GitHub to trigger Vercel. Stop at a production migration gate until the user explicitly approves the displayed SQL.