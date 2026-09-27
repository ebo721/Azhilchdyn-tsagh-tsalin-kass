---
name: Bank cash account precedence
description: Why bank-to-cash journal creation uses the bank transaction's assigned GL account instead of a separate category input.
---

When creating a cash entry and journal from a bank transaction, use the GL account already assigned to that bank transaction as the accounting classification. Do not require a second free-text expense subcategory.

**Why:** The user confirmed that the bank transaction already has an expense account selected, so asking for a subcategory duplicates classification and can lead to a different journal account.

**How to apply:** For future bank-to-cash flows, verify that cash, journal, and any mirrored operating expense agree on the assigned account. Reject a missing or incompatible account rather than silently posting to a generic fallback.