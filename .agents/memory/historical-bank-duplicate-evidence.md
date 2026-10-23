---
name: Historical bank duplicate evidence
description: Evidence and approval boundaries for historical cross-account bank import cleanup.
---

Do not infer the correct source bank account from an earlier import, an existing cash/journal link, or identical running balances. The bank account stored on an imported transaction reflects the account selected during import, not independent proof of statement ownership.

**Why:** Historical imports did not validate statement ownership. A copied statement can therefore have identical transactions and balances under two different source accounts, including rows with financial or internal-transfer links.

**How to apply:** Obtain original statements with owner-account headers and reconcile their transaction rows before selecting keep/remove records. Leave unconfirmed pairs unchanged. Show exact affected IDs, preserved links, execution steps and rollback to the user and obtain separate approval before production writes. Keep production reports and source-account evidence out of Git.
