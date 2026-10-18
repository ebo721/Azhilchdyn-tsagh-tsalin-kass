---
name: Integration fixtures and reconciliation
description: Shared development data can gain new dependent mirrors during integration tests.
---

Integration tests that list cash or expenses may reconcile other tests' bank–cash fixtures and create dependent expense mirrors. Fixture cleanup must remove fixture-owned mirrors before deleting cash.

**Why:** Independently passing bank lifecycle tests failed their cleanup when another test suite reconciled the shared development database and created expense references.

**How to apply:** Clean only dependencies identified by the fixture's own records. Run suites serially when global reconciliation could interfere with their assertions or cleanup; never delete unrelated development data.

Temporary GL accounts can also be referenced by another concurrently running suite through shared bank-recognition context. An account cleanup may fail while those foreign journal lines exist, then become safe after the other suite finishes.

**Why:** All regression assertions passed, but a suite's account cleanup hit a foreign-key restriction; the same suite completed cleanup when run alone.

**How to apply:** Inspect suite-level teardown errors even when the runner reports zero failing assertions or exits successfully. Financial suites sharing recognition context should run serially until fixture isolation and cleanup ordering are robust.
