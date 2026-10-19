---
name: Saved payroll refresh policy
description: User-required distinction between viewing saved calculations, pulling attendance, and live financial movements.
---

Цалин нээх, дахин нэвтрэх, refresh хийхэд хадгалсан бодолтыг харуулна. Зөвхөн «Цаг татах» дарахад тухайн хугацааны ирцээс цаг, орлогыг дахин бодно. Бүртгэсэн цалин олголтыг хэвээр хадгална.

**Why:** The user explicitly requested persistent server calculations rather than a browser-cache workaround or simply hiding the loading indicator.

**How to apply:** Report downloads and approving/reversing advance payments must not silently pull attendance. Payments and deductions still update financial amounts without refreshing saved earnings. Approved advances stay frozen. A month with no saved calculation must ask for an explicit pull; the separate explicit historical-balance repair remains necessary when prior financial debt is invalid.

Цалингийн сарыг хаадаг байх; хаасан сарын үлдэгдлийг дахин татах шаардлагагүй байх.
Хаасан сарыг зөвхөн админ дахин нээж засдаг байх.

**Why:** The user explicitly requested month closure so a closed month's balance does not need to be pulled again.

**How to apply:** Month closure must preserve finalized balances for subsequent months to read without recalculating the closed period. Do not confuse reading the saved closing balance with pulling attendance or rebuilding historical balances.
