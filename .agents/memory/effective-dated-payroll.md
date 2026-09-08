---
name: Effective-dated payroll
description: Durable rules for employment dates, salary history, monthly proration, and protecting paid payroll.
---

Monthly office salary is prorated across the month's Monday–Friday workdays. The joined date is the first eligible day, and the inactive date is the final eligible day. Attendance marked as leave is not a paid workday and must be excluded from office salary and social-insurance salary proration. Salary changes apply beginning on their effective date, splitting old and new rates by eligible workdays. Shift attendance uses the rate effective on each attendance date. A salary change must not reach back into a month whose payroll was already paid.

When an office employee's present/late attendance exceeds their required weekdays for the month, add one daily share of salary and social-insurance salary for each excess day, using the rate effective on the extra attendance date.

A newly entered salary effective from an earlier date supersedes and removes later salary-history entries; otherwise stale future rows can override the user's latest correction.

Payroll deductions are based on the effective social-insurance salary: employee social insurance is 11.5%; taxable income is social-insurance salary minus that contribution; calculated personal income tax is 10% of taxable income; final income tax is calculated tax minus the applicable relief, floored at zero.

When an approved payroll-advance line is changed from paid back to unpaid, refresh that employee's salary and first-half worked days, recalculate the advance, and remove its cash expense in the same transaction.

Salary-history correction may change its effective date, base salary, and social-insurance salary, but must be rejected if it would affect a month with paid payroll. The initial row must keep the employee's joined date. Deletion must preserve that baseline. Editing or deleting the latest row must update the employee's current salary fields in the same transaction.

**Why:** The user explicitly chose workday-based proration and confirmed that the inactive date is inclusive. Historical payroll must remain based on the salary that applied at the time rather than the employee's latest salary.

**How to apply:** Preserve effective-dated salary history whenever salary inputs change. When replacing a salary from an effective date, remove that employee's history on or after the date before inserting the replacement. For payroll changes, resolve rates by date, exclude leave dates, include inactive employees whose employment overlaps the requested month, and reject retroactive salary changes or history deletion that would affect an already-paid month.