---
name: Payroll integration test runtime
description: Long-running salary-history tests and the risk of interrupted fixture cleanup.
---

When verifying payroll changes, do not assume the salary-history integration suite fits a short shell timeout. A full run can take over 13 minutes because individual payroll summary requests have taken roughly a minute in the development environment.

**Why:** The same unchanged 12-test suite on the commit before the payroll-helper extraction passed all cases but took about 13 minutes; 13 payroll requests had a 59.6-second median. The slowdown predates that extraction. Earlier externally timed-out runs showed partial passes but never reached their suite result. External process termination can prevent its after-hook from cleaning test fixtures, so a timeout is not a test failure or proof that the database is clean.

**How to apply:** Prefer bounded, targeted payroll tests for quick verification. For a full integration run, allow sufficient time and confirm cleanup; if interrupted, inspect only test-owned fixtures before considering deletion. Never infer that a partial pass means the full suite passed.