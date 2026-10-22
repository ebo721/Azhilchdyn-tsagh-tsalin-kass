---
name: Historical salary coverage
description: Why missing early salary history must not fall back to current employee settings.
---

When salary history exists but no row covers a calculation date, stop with a configuration error instead of using the employee's current salary, insurance base or exemption. Do not backdate the earliest history row or apply a later exemption retroactively without confirming the intended effective dates.

**Why:** A September exempt employee's baseline started after the beginning of the calculation period. Falling back to current employee settings imported an October insured salary into the uncovered September days and created unintended insurance and income-tax deductions. A separate employee had an explicitly October-dated exemption, which must not be confused with the same bug.

**How to apply:** Apply this boundary to salary and advance calculations through their common dated-settings lookup. Preserve saved calculations, closures and payments until a targeted historical correction is authorized; verify resulting carryovers after repair. Employees with no history at all remain a separate legacy-compatibility case.

Load future salary-history rows too when resolving an earlier period. Otherwise, a query that removes all future rows makes an uncovered period indistinguishable from an employee who has no history, bypassing the coverage check.

**Why:** A missing baseline must be detected before the legacy no-history fallback is considered, regardless of how the caller loads history.

The user requires checking the employee registration before payroll and explicitly chose the tax status effective for the calculated period, not today's status retroactively. Require dated history when calculating actual earnings, even when no rows exist. Check that the register's exemption flag matches its latest history row, including a future-dated latest row; then use the row effective on each earning date.

**Why:** Checking today's flag against an old period would incorrectly reject legitimate later exemptions or backdate them. Undated fallback settings cannot establish a historical tax obligation.

**How to apply:** Stop with an actionable configuration error for missing coverage, no history, or a register/latest-history exemption mismatch when earnings need calculation. Do not auto-correct history, refresh saved pay merely by opening a page, or change recorded payments.

Attendance-free periods with no effective full-salary entitlement create zero new earnings and zero payroll taxes; they must not fail merely because salary history begins later. Preserve saved financial carryovers and payments. Do not require an advance draft before salary history starts when that advance period is also empty.

**Why:** Explicit financial initialization may traverse months before the first salary row. An unconditional history check in a zero-earning month blocked preparing later payroll. This does not justify inventing rates for other uncovered months that do contain worked attendance.

**How to apply:** Distinguish empty periods from worked periods and from dated full-salary exceptions. Keep missing-history errors for real earnings or an undocumented full-salary exception; do not silently backdate a later rate or exemption.
