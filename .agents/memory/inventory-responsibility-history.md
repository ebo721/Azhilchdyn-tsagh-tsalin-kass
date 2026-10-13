---
name: Inventory responsibility history
description: Custodian names in historical inventory documents must survive settings changes.
---

Нярав олон хүн байж болно. Няравыг ажилчдын жагсаалтаас нэрээр хайж сонгоно. Configure multiple existing employees under the warehouse role, rather than typing names or granting every custodian a login.

**Why:** The user clarified that custodians are people from the employee directory, not one name per login account.

**How to apply:** Keep employee identity separate from login identity. Never infer employee matches from legacy free-text names.

Keep the name selected at document time on historical records, even if settings change or the employee is renamed or deleted.

**Why:** Responsibility is an audit fact about an existing inventory movement, not a live label to rewrite when an administrator edits the user directory.

**How to apply:** Updating unrelated document fields must preserve the saved assignment. Only a newly chosen responsible person updates the saved name. Never replace missing historical names with login usernames.
