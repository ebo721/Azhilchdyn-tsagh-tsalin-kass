---
name: Historical salary coverage
description: Why missing early salary history must not fall back to current employee settings.
---

When salary history exists but no row covers a calculation date, stop with a configuration error instead of using the employee's current salary, insurance base or exemption. Do not backdate the earliest history row or apply a later exemption retroactively without confirming the intended effective dates.

**Why:** A September exempt employee's baseline started after the beginning of the calculation period. Falling back to current employee settings imported an October insured salary into the uncovered September days and created unintended insurance and income-tax deductions. A separate employee had an explicitly October-dated exemption, which must not be confused with the same bug.

**How to apply:** Apply this boundary to salary and advance calculations through their common dated-settings lookup. Preserve saved calculations, closures and payments until a targeted historical correction is authorized; verify resulting carryovers after repair. Employees with no history at all remain a separate legacy-compatibility case.

Load future salary-history rows too when resolving an earlier period. Otherwise, a query that removes all future rows makes an uncovered period indistinguishable from an employee who has no history, bypassing the coverage check.

**Why:** A missing baseline must be detected before the legacy no-history fallback is considered, regardless of how the caller loads history.
