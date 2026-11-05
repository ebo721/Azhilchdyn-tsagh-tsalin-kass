---
name: Employee insurance import scope
description: Why insurance-report identity imports do not replace salary settings or employee display names.
---

НДШ загвараар одоо байгаа ажилтны мэдээлэл шинэчлэхэд ижил овог, нэртэй ажилтан байвал хэрэглэгчээр аль хүн болохыг сонгуулна. Регистр таарсан ч нэр давхардвал автоматаар эхний хүнийг сонгохгүй.

**Why:** The user explicitly said “Ижил овог нэртэй ажилтан байвал лавлаж асууна.”

**How to apply:** Keep duplicate resolution explicit and never infer permission to create new employees from an unmatched report row.

Treat the insurance template's salary and income columns as reported amounts, not instructions to replace contractual salary, salary history, tax exemptions or payments. Empty cells preserve stored metadata.

**Why:** Reporting totals may include bonuses or a partial period and do not establish an effective-dated salary agreement. An identity import must not modify financial history.

**How to apply:** Import reporting identity/contact fields only. Any later request to import financial values needs a separately scoped effective-dated payroll workflow.

Keep the official given name separate from an employee's existing initial-prefixed display name.

**Why:** The report needs an unabridged name, while silently replacing display names can alter established directory labels and consumers of employee identity.

**How to apply:** Use the reporting given name in official exports; do not treat an identity import as permission to rewrite historical document names.
