---
name: Automatic posting lifecycle reviews
description: Review rule for source-linked general-ledger posting across the full transaction lifecycle.
---

An automatic posting integration is incomplete if it only posts when the source row is first created. Review every route that can edit, link, cancel, or delete the source and ensure the linked journal remains consistent.

**Why:** A create-only review missed that later cash edits could replace a bank-settled journal with a cash-settled journal, and that cancellation routes could leave posted activity behind.

**How to apply:** Track payment provenance through the persisted source link. Preserve cash-versus-bank settlement accounts on updates, avoid duplicate posts on retries, void and repost changed activity, reverse cancellations and deletions, and do not backfill historical rows without an explicit migration. When a bank row and cash row represent one settlement, link both to the same journal entry, block source-side mutation, and serialize bank deletion against journal posting. Reversal must clear both sides of the settlement link so the rows can be matched again, while preserving the original business-source identity such as payroll employee/month keys.

For payment sources that may be recorded from either side (for example payroll first or bank first), both writers must share the same transaction lock and check the opposite source before inserting. Suggestions alone do not prevent duplicates, and a one-sided check still fails when the other writer commits first.

When a workflow needs both a date-scoped advisory lock and a source-row lock, acquire all date locks first in sorted order, then lock source rows. If the date was read before locking, re-read after the row lock and retry on change rather than taking another date lock while holding the row.

Payroll and payroll-advance payment records must create or update an unjournaled cash expense. A journal is created only by explicit Cash posting or by linking the payment to a bank transaction; removing a bank link leaves the cash row unjournaled.

**Why:** Recording “paid” confirms the business payment state but does not prove whether settlement came from cash or bank. Automatic posting can create the wrong settlement account and later require avoidable reversals.

**How to apply:** Keep new payroll cash rows at `journalEntryId = null`. Preserve and replace an existing explicitly posted cash journal when its amount or date changes, but never create a first journal from payroll payment, cash-row editing, or bank unlinking.

The Journal screen’s “Delete” action permanently deletes only the selected journal entry and its lines. It must not create a reversal or delete the source transaction.

**Why:** In this product, reversal is a separate accounting behavior; users expect “Delete” to remove the selected journal itself.

**How to apply:** Use hard delete for the Journal screen action, rely on journal foreign keys to clear `journalEntryId`, leave cash/bank/source rows intact, and reject deletion when receivable records restrict it.