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

Purchase lists must show bank-link labels, filtering, and transaction facts in purchase details. Linking a bank transaction automatically confirms payment, and new purchase payments require a bank transaction.

**Why:** The user approved labels and filtering, then required: “банктай холбогдсон бол шууд төлбөр төлсөн болдог байх төлбөр төлсөн болгоход заавал гүйлгээтэй холбоно.”

**How to apply:** Require bank selection in both the payment UI and API; cover individual, grouped, and completed pending purchases. Preserve historical bankless payments rather than rewriting financial history. Do not treat cancelled or historical links as current connections.
