---
name: Payroll schedule immutability
description: Safety rules that prevent schedule changes from rewriting approved or paid payroll periods.
---

Treat the payroll schedule as one global configuration with effective-month versions. A selected payroll month must always resolve the latest version effective on or before that month.

**Why:** A mutable singleton can retroactively change approved advances, paid payroll, and recursive carryover calculations. Concurrent schedule edits and approval/payment writes can also freeze amounts under one cycle while displaying another.

**How to apply:** Reject edits whose affected version range contains approved or paid payroll. Serialize schedule changes, advance approvals, and paid payroll writes with the shared payroll schedule transaction lock. Preserve these guarantees in new payroll write paths.

Reuse effective-dated schedule versions only within a payroll calculation request, not in an unbounded process-wide cache.

**Why:** Historical carryover needs the schedule effective in each prior month, while the next request must observe schedule corrections immediately. Eliminating historical database round-trips must not introduce stale payroll rules.

**How to apply:** Load the applicable versions once per summary request and resolve each historical month from that collection; retain the existing default initialization when early employment predates the first version.