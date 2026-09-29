---
name: Bank-settled fixed assets
description: Accounting lifecycle rule for fixed assets whose purchase was settled from an imported bank transaction.
---

Once a fixed-asset purchase is linked to a bank transaction, edits are allowed only when the edited date and total still exactly match that bank transaction and the purchased status remains true. A valid edit must update the asset and compatibility cash row, void the prior bank journal, and post the replacement bank journal atomically. Ordinary deletion remains blocked.

**Why:** The original fixed-asset flow posts credit to cash, while bank settlement posts credit to bank. A bank-linked edit must preserve that settlement and cannot change the bank statement's date or amount. Reusing the cash lifecycle can silently recreate a cash-credit journal or leave the bank transaction claimed without an active bank-credit journal.

**How to apply:** Treat the bank transaction, fixed-asset source cash row, original/reversal journals, and replacement bank journal as one accounting aggregate. Lock and reconcile all of them in one database transaction; reject mismatches before any writes.

Use the fixed-asset registration as the source record for a bank-funded purchase: link an existing matching asset or create it atomically from the bank flow, and classify the settled bank expense to the fixed-asset GL account. Preserve the asset's identity through later payment corrections.

**Why:** The user plans asset coding and depreciation later. Those must attach to the durable asset identity, not a bank statement row or replaceable cash/journal posting. Reusing the current asset register avoids a competing purchase source while keeping account classification consistent.

**How to apply:** Keep bank settlement dependent on a fixed-asset record and retain its ID when reconciling cash and journal entries. Do not infer or implement depreciation or asset codes as part of the initial bank link.