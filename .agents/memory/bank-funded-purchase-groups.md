---
name: Bank-funded purchase groups
description: User-chosen settlement scope for linking one bank transfer to multiple inventory purchases.
---

Allow one bank expense to pay multiple existing inventory purchases only when **each purchase is settled in full** and their combined amount exactly equals the bank transaction. Partial allocations were explicitly offered and declined.

**Why:** A partial-payment ledger would need separate balances, reversal rules, and UI; silently treating a partially funded purchase as paid would misstate inventory payment status and accounting.

**How to apply:** Keep the full-amount rule consistent across both group and individual bank-linked payment paths. A grouped payment is one financial settlement: show its linked purchases together and reverse it atomically rather than letting a single member be independently unlinked or deleted.

Allow a purchase document dated **on or before** a bank settlement to be linked without changing the document date. The payment date and cash/journal posting date are the bank transaction date; a document dated after the payment must not be linked.

**Why:** The user explicitly confirmed that a purchase recorded earlier may be paid by a later bank transaction. Requiring identical dates hides legitimate unpaid purchases, while rewriting their document dates loses the original record.

**How to apply:** Use this date rule in candidate lists, link validation, and group cancellation integrity checks. Do not infer payment from the document date.

Keep a grouped bank payment homogeneous by material type: all food/inventory purchases or all supply purchases. Reject a mixed group until its cash representation can carry a split classification.

**Why:** One bank-linked cash row has only one category and one asset account. A mixed 1500/1510 journal can be correct while that single cash row misstates one side of the purchase.

**How to apply:** Validate group material types before claiming the bank row; use the corresponding asset account and category for homogeneous cash rows and display them consistently. Do not silently default a mixed group to inventory.