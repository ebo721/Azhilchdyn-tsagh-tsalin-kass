---
name: Pending inventory purchase scope
description: User-requested bank purchase accounting before item and supplier details are known, without restructuring existing workflows.
---

Allow bank-funded inventory/supply purchases to appear as “Бүртгэлгүй” when the item, quantity and supplier are unknown. Show only the known bank facts (date, amount, description, account), with “Бүртгэлтэй / Бүртгэлгүй” filtering alongside the purchase list.

**Why:** The user requires financial posting before the purchase breakdown is available, and explicitly said not to restructure or break the existing logic or make this a large development.

**How to apply:** Post cash and the appropriate inventory/supply GL account once, without inventing a supplier or adding stock. Completing the existing purchase form must exactly match the bank amount, add real stock once, and reuse the posted accounting rather than creating another payment or expense. Preserve the normal purchase/payment lifecycle.

When registering a pending purchase, suggest existing purchases with the same amount or material type, but do not suggest purchases that are already linked.

**Why:** The user requested suggestions so an existing purchase can be linked instead of registering it again.

**How to apply:** Keep suggestion relevance separate from settlement eligibility: a type-only or amount-only match is not permission to violate the exact-total and matching-material rules. A cancelled link is historical evidence, not an active settlement.

Purchase lists must distinguish bank-linked from unlinked purchases independently of paid/unpaid status, with a bank-link filter and transaction facts in the purchase details.

**Why:** The user explicitly approved adding labels and filtering after learning that “Төлбөр төлсөн” also includes payments confirmed without a bank transaction.

**How to apply:** Include both individual and grouped current bank links. Do not treat a cancelled group, a historical bank identifier, or payment confirmation alone as a current bank connection.
