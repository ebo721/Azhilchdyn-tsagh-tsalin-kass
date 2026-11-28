---
name: Insurance employee registration roster
description: Eligibility rules for the employee-registration Excel uploaded to the social insurance system.
---

НДШ системд ажилтан бүртгэх Excel-д зөвхөн одоо идэвхтэй, НДШ-ээс чөлөөлөгдөөгүй, НДШ тооцох цалин нь эерэг ажилтан орно. Бүртгэлийн жагсаалт нь сарын тайлан биш тул ажилласан өдөр шаардахгүй.

**Why:** The user clarified that the registration download must list only employees who owe social insurance.

**How to apply:** Require `status === "active"`, `payrollTaxExempt === false`, and `socialInsuranceSalary > 0`; do not add a selected-month workday filter to this registration template.
