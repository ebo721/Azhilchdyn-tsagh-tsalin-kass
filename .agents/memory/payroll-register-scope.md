---
name: Monthly payroll register scope
description: Earnings roster must not show debt-only employees; financial ledgers must retain them.
---

Цалингийн жагсаалтад зөвхөн тухайн сард ажилласан ирцтэй, цалин бодогдож буй ажилтан болон ирцээс үл хамааран цалин авах ажилтан харагдана. Өмнөх өглөг, авлагатай гэдгээр нь дангаар нь ажилтан харуулахгүй.

**Why:** The user explicitly requested removing employees with no monthly salary who appeared solely because of prior debt.

**How to apply:** Keep the register and its Excel exports separate from the complete financial ledger. Do not filter or delete financial carryforwards, historical payments, bank settlement candidates, or payables/party-ledger sources to achieve the display rule. Saved earnings remain authoritative; opening the register does not recalculate payroll. Uncomputed/zero rows may check current-period present/late employment dates and effective-dated guaranteed-salary weekdays solely to determine roster membership, so newly worked employees remain reachable for explicit refresh. Future guarantees and gaps before known history do not grant historical entitlement. Closed-month membership uses saved earnings only.
