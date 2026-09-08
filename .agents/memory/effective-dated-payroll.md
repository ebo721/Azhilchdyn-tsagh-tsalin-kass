---
name: Effective-dated payroll
description: Durable rules for employment dates, salary history, monthly proration, and protecting paid payroll.
---

Monthly office salary is prorated across the month's Monday–Friday workdays. The joined date is the first eligible day, and the inactive date is the final eligible day. Salary changes apply beginning on their effective date, splitting old and new rates by eligible workdays. Shift attendance uses the rate effective on each attendance date. A salary change must not reach back into a month whose payroll was already paid.

**Why:** The user explicitly chose workday-based proration and confirmed that the inactive date is inclusive. Historical payroll must remain based on the salary that applied at the time rather than the employee's latest salary.

**How to apply:** Preserve effective-dated salary history whenever salary inputs change. For payroll changes, resolve rates by date, include inactive employees whose employment overlaps the requested month, and reject retroactive salary changes that would affect an already-paid month.