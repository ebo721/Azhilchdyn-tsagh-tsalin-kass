---
name: Bank-funded purchase groups
description: User-chosen settlement scope for linking one bank transfer to multiple inventory purchases.
---

Allow one bank expense to pay multiple existing inventory purchases only when **each purchase is settled in full** and their combined amount exactly equals the bank transaction. Partial allocations were explicitly offered and declined.

**Why:** A partial-payment ledger would need separate balances, reversal rules, and UI; silently treating a partially funded purchase as paid would misstate inventory payment status and accounting.

**How to apply:** Keep the full-amount rule consistent across both group and individual bank-linked payment paths. A grouped payment is one financial settlement: show its linked purchases together and reverse it atomically rather than letting a single member be independently unlinked or deleted.