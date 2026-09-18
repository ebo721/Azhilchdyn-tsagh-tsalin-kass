---
name: Bank-settled fixed assets
description: Accounting lifecycle rule for fixed assets whose purchase was settled from an imported bank transaction.
---

Once a fixed-asset purchase is linked to a bank transaction, ordinary fixed-asset edit and delete operations must reject it. Any future correction or unlink feature must update the bank claim, compatibility cash row, and active/reversal journals atomically.

**Why:** The original fixed-asset flow posts credit to cash, while bank settlement posts credit to bank. Reusing the ordinary edit/delete lifecycle after linking can silently recreate a cash-credit journal or leave the bank transaction claimed without an active bank-credit journal.

**How to apply:** Treat the bank transaction, fixed-asset source cash row, original/reversal journals, and replacement bank journal as one accounting aggregate. Lock and reconcile all of them in one database transaction.