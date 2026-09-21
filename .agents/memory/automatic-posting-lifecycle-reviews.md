---
name: Automatic posting lifecycle reviews
description: Review rule for source-linked general-ledger posting across the full transaction lifecycle.
---

An automatic posting integration is incomplete if it only posts when the source row is first created. Review every route that can edit, link, cancel, or delete the source and ensure the linked journal remains consistent.

**Why:** A create-only review missed that later cash edits could replace a bank-settled journal with a cash-settled journal, and that cancellation routes could leave posted activity behind.

**How to apply:** Track payment provenance through the persisted source link. Preserve cash-versus-bank settlement accounts on updates, avoid duplicate posts on retries, void and repost changed activity, reverse cancellations and deletions, and do not backfill historical rows without an explicit migration. When a bank row and cash row represent one settlement, link both to the same journal entry, block source-side mutation, and serialize bank deletion against journal posting. Reversal must clear both sides of the settlement link so the rows can be matched again, while preserving the original business-source identity such as payroll employee/month keys.