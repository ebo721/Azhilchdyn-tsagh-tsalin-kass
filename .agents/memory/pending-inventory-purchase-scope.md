---
name: Pending inventory purchase scope
description: User-requested bank purchase accounting before item and supplier details are known, without restructuring existing workflows.
---

Allow bank-funded inventory/supply purchases to appear as “Бүртгэлгүй” when the item, quantity and supplier are unknown. Show only the known bank facts (date, amount, description, account), with “Бүртгэлтэй / Бүртгэлгүй” filtering alongside the purchase list.

**Why:** The user requires financial posting before the purchase breakdown is available, and explicitly said not to restructure or break the existing logic or make this a large development.

**How to apply:** Post cash and the appropriate inventory/supply GL account once, without inventing a supplier or adding stock. Completing the existing purchase form must exactly match the bank amount, add real stock once, and reuse the posted accounting rather than creating another payment or expense. Preserve the normal purchase/payment lifecycle.
