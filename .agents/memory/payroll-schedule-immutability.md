---
name: Payroll schedule immutability
description: Safety rules that prevent schedule changes from rewriting approved or paid payroll periods.
---

Treat the payroll schedule as one global configuration with effective-month versions. A selected payroll month must always resolve the latest version effective on or before that month.

**Why:** A mutable singleton can retroactively change approved advances, paid payroll, and recursive carryover calculations. Concurrent schedule edits and approval/payment writes can also freeze amounts under one cycle while displaying another.

**How to apply:** Reject edits whose affected version range contains approved or paid payroll. Serialize schedule changes, advance approvals, and paid payroll writes with the shared payroll schedule transaction lock. Preserve these guarantees in new payroll write paths.

Reuse effective-dated schedule versions only within a payroll calculation request, not in an unbounded process-wide cache.

**Why:** Explicit financial-ledger initialization/repair needs the effective schedule for each affected month, while an ordinary payroll request needs only its selected period. The next request must observe schedule corrections immediately.

**How to apply:** Resolve only the selected month's schedule in an ordinary summary. During explicit initialization/repair, use each affected month's effective version; retain default initialization for early employment. Never restore recursive historical attendance calculations in a normal summary.