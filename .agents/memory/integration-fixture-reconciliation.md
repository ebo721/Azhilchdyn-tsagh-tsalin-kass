---
name: Integration fixtures and reconciliation
description: Shared development data can gain new dependent mirrors during integration tests.
---

Integration tests that list cash or expenses may reconcile other tests' bank–cash fixtures and create dependent expense mirrors. Fixture cleanup must remove fixture-owned mirrors before deleting cash.

**Why:** Independently passing bank lifecycle tests failed their cleanup when another test suite reconciled the shared development database and created expense references.

**How to apply:** Clean only dependencies identified by the fixture's own records. Run suites serially when global reconciliation could interfere with their assertions or cleanup; never delete unrelated development data.
