---
name: Fast reopen UI verification
description: Slow automated scrolling can hide stale form snapshots after successful saves.
---

Verify important actions are inside the phone viewport, then test immediate reopening after a save without added delays.

**Why:** Automated scrolling to an off-screen save button masked a cache race. Once the button fit on the phone screen, rapid reopening showed the previous selection despite a successful server update.

**How to apply:** Use viewport bounds checks as well as visibility checks. Patch the saved response into the cache or finish its refresh before dismissing a form whose reopened state comes from that cache. Do not fix this failure by slowing down the test.
