---
name: Employee recipient accounts
description: Why employee payment accounts are stored explicitly rather than continuously inferred from bank imports.
---

Treat the employee's saved recipient account as an editable payment instruction. Historical bank reconciliation must not silently overwrite a manually entered account. Initial population may use the latest verified salary-payment link, but never infer an employee by name or amount alone.

**Why:** A statement also contains the company's funding account, and correcting or importing historical links is not authorization to change where an employee's next salary should be sent. The user requested an explicit pull button in employee details, which is not permission for background synchronization. When the newest verified recipient account is incomplete, leaving it blank is safer than substituting an older account.

**How to apply:** Keep recipient-account edits deliberate, preserve leading zeroes, and show the full saved number during payroll adjustment. Do not add automatic account replacement to bank-posting or reconciliation hooks without an explicit product decision.
