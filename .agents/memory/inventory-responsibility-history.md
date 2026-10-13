---
name: Inventory responsibility history
description: Custodian names in historical inventory documents must survive settings changes.
---

Configured warehouse-role names supply purchase/issue responsibility choices. Keep the name selected at document time on historical records, even if the account is renamed, changes role, or is deleted.

**Why:** Responsibility is an audit fact about an existing inventory movement, not a live label to rewrite when an administrator edits the user directory.

**How to apply:** Updating unrelated document fields must preserve the saved assignment. Only a newly chosen responsible person updates the saved name. Never replace missing historical names with login usernames.
