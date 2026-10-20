---
name: Payroll payables scope
description: The user chose a live view of saved payroll debt in payables, not automatic liability journals.
---

Цалингийн өглөгт хэрэглэгч “Үлдэгдлийг өглөгт шууд харуулах” хувилбарыг сонгосон. Шинэ өглөгийн журнал автоматаар үүсгэхгүй.

**Why:** The user explicitly chose this instead of changing payroll accrual and settlement journal flows.

**How to apply:** Show saved unpaid payroll separately from journal-backed payables, update it from recorded payroll payments/cancellations, and never sum monthly carryforward snapshots as independent debts. Payroll remains the payment source; do not settle these displayed balances through generic journal-payable allocation.
