---
name: Social insurance upload roster
description: The ndaatgal.mn-format workbook is limited to currently active employees who worked and owe social insurance.
---

НДШ-ийн ndaatgal.mn upload Excel-д зөвхөн одоогийн төлөв нь идэвхтэй, сонгосон сард бодит ажилласан өдөртэй, НДШ тооцох цалин нь эерэг ажилтан орно. Энэ шүүлтүүр нь НДШ upload workbook-д хамаарна; ерөнхий цалингийн Excel болон түүхэн цалингийн бүртгэлийг хумихгүй.

**Why:** The user clarified that “идэвхтэй” means currently active and requested the NДШ upload roster to include employees who worked during the selected month.

**How to apply:** Build the NДШ report from the selected month's saved payroll lines, require `daysWorked > 0` and `socialInsuranceSalary > 0`, then require the employee's current status to be active. Do not apply the current-status filter to historical payroll exports.
