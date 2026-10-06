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
