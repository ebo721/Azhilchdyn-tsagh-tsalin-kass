---
name: Effective-dated payroll
description: Durable rules for employment dates, salary history, monthly proration, and protecting paid payroll.
---

Monthly office salary is prorated across the month's Monday–Friday workdays. The joined date is the first eligible day, and the inactive date is the final eligible day. Attendance marked as leave is not a paid workday and must be excluded from office salary and social-insurance salary proration. Salary changes apply beginning on their effective date, splitting old and new rates by eligible workdays. Shift attendance uses the rate effective on each attendance date.

When an office employee's present/late attendance exceeds their required weekdays for the month, add one daily share of salary and social-insurance salary for each excess day, using the rate effective on the extra attendance date.

A newly entered salary must have an effective date later than the latest salary-history row and is appended without removing prior rows. Historical corrections use the dedicated salary-history row editor.

Payroll deductions are based on the effective social-insurance salary: employee social insurance is 11.5%; taxable income is social-insurance salary minus that contribution; calculated personal income tax is 10% of taxable income; final income tax is calculated tax minus the applicable relief, floored at zero.

When an approved payroll-advance line is changed from paid back to unpaid, refresh that employee's salary and first-half worked days, recalculate the advance, and remove its cash expense in the same transaction.

Salary-history correction may change its effective date, base salary, and social-insurance salary even when it recalculates a paid month. The recorded paid amount must remain unchanged; recalculation produces the resulting payable or receivable balance. A salary effective date is independent of the employment joined date and must not change it. Deletion must preserve the baseline salary row. Editing or deleting the latest row must update the employee's current salary fields in the same transaction.

Each month's signed payroll balance carries forward into the next month's take-home pay: underpayment increases it, overpayment decreases it, and any excess balance continues across later months until fully offset.

In payroll reporting, split the brought-forward balance into salary payable (prior underpayment owed to the employee) and salary receivable (prior overpayment recoverable from the employee), while retaining the current-month difference.

In the payroll adjustment dialog, show the settlement equation explicitly: current-month take-home pay − paid salary + salary payable − salary receivable = salary due for payment.

The payroll table's “Сүүл цалин” column and its footer total show current-month take-home pay only; brought-forward salary payable/receivable remain separate and are included only in salary due for payment.

Label that table column “Гарт олгох”. Its adjacent difference is current-month take-home pay minus paid amount only; brought-forward payable/receivable must not be included in that displayed difference.

Treat signed payroll balances from -1₮ through +1₮ as zero. Display underpayments in parentheses and overpayments as ordinary positive amounts, without text labels.

An office employee must have at least one attendance record in a month before base salary or payroll taxes are calculated. A month with no attendance contributes zero new salary and zero new balance.

An admin-only full-salary exception may override attendance for a specific employee. Store it in effective-dated salary history. While enabled, eligible employment days receive the full monthly office salary or the shift rate multiplied by expected workdays, with social-insurance salary prorated over employment dates; joined and inactive dates still bound eligibility. Non-admin roles must not be able to change this exception through the API.

**Why:** The user explicitly chose workday-based proration, confirmed that the inactive date is inclusive, and requested a per-employee admin-only override that pays the full base salary regardless of attendance. Historical payroll must use the effective rule while preserving the immutable record of money already paid.

**How to apply:** Create the first salary-history row from the employee's initial salary, full-salary setting, and joined date. Append later salary or exception changes with their own effective dates and never remove earlier rows during normal employee edits. Use the row editor for corrections. For payroll changes, resolve rates and the exception by date, exclude leave dates unless the exception is enabled, and include inactive employees whose employment overlaps the requested month. Allow history corrections to recalculate paid months without mutating paid amounts; keep deletion protection for history that affects paid payroll.