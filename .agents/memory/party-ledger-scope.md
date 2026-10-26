---
name: Party ledger scope
description: Confirmed manual-journal inclusion and read-only reconciliation boundaries.
---

Include `manual` journals when persisted source documents or allocations establish the party. Exclude journals without a confirmed party link; never infer ownership from names or descriptions.

**Why:** The specification originally excluded all manual journals, but the existing employee debt registration flow also labels its journals manual. The user explicitly chose to include document-backed manual journals after this conflict was explained.

**How to apply:** Preserve this exception when changing the read-only party ledger or its source ownership rules. Do not change journal provenance, add columns, backfill, or write accounting entries as part of this report. Keep saved payroll balances separate from the 1200/2000 ledger rather than combining the two debts.
