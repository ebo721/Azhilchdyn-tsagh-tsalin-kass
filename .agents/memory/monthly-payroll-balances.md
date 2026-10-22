---
name: Monthly payroll balances
description: Current-period attendance only; prior-period payroll debt comes from saved financial records.
---

Цалинг бодоход зөвхөн тухайн сарын ирцийн мэдээлэл татна. Өмнөх сараас зөвхөн цалингийн авлага өглөгийн мэдээлэл хэрэгтэй.

**Why:** The user explicitly required this instead of loading all attendance and recalculating historical payroll on every request.

**How to apply:** Use the effective payroll period (which can cross calendar months), not an unconditional calendar-month filter. Normal payroll and insurance export must never rebuild old attendance to obtain carryover. Missing or invalidated financial balances must be explicitly prepared or repaired; do not guess zero or serve stale debt.

Source corrections must invalidate the affected saved financial results. Recompute affected earnings only during explicit initialization/repair, then propagate the change through saved financial movements without rereading unaffected attendance. Preserve recorded payments and apply the monthly ±1₮ tolerance before carrying a balance forward.

**Why:** Historical salary/attendance corrections must still change later debt, but they cannot reintroduce all-history reads into ordinary payroll.

**How to apply:** Keep financial initialization resumable, reject incomplete/stale prior balances, and retain source-write serialization with ledger calculations. Derived ledger rollback must not delete source attendance or payments.

The user selected a reviewed, signed opening payable/receivable balance per employee and refresh controls visible only for employees whose earnings or financial inputs changed. The opening balance is a manually confirmed financial boundary, never an automatic estimate from the latest salary settings; historical edits before it require renewed review of that employee's amount. A confirmation's month stays fixed; corrections create an audit revision for the same month. Unchanged people should not reread attendance because another person's history changed.

**Why:** An old missing salary-history row could block refreshing everyone while reconstructing years of debt; truncating history to a fixed lookback would instead silently lose genuine receivables/payables.

**How to apply:** Read current saved earnings without pulling attendance. Show incomplete totals while any employee needs refresh or baseline review, preserve recorded payments and finalized months, and never silently assume an unknown opening amount is zero.
