---
name: Git and hosting boundaries
description: Security and configuration boundaries for GitHub, Replit, and Vercel workflows.
---

Never push database dump or backup files to GitHub. Keep Replit runtime configuration separate from Vercel deployment configuration rather than trying to make one platform consume the other's files.

**Why:** Database dumps can contain password hashes, financial records, and other production data. Vercel does not read `.replit`, so combining those settings adds risk without improving deployment behavior.

**How to apply:** Before pushing from Replit, verify that dumps and backups are excluded from Git history. Preserve `.replit` for Replit workflows, and keep Vercel-specific routing and build settings in Vercel-supported configuration.