---
name: Bank-sourced balance scope
description: User-required dates and financial meaning of creating new receivables/payables from bank transactions.
---

“банкны гүйлгээнээс шууд авлага/өглөг үүсгэж болдог байх, тухайн гүйлгээний огноогоор автоматаар үүсгэнэ.”

**Why:** The user explicitly asked for direct bank-sourced debt registration using the transaction date, not the date the accountant enters it.

**How to apply:** Take date and amount from the stored bank transaction, not editable client values. Creating new debt differs from repayment: outgoing bank funds create a receivable; incoming borrowed/held funds create a payable. Use the existing journal allocation lifecycle so a retry cannot produce another debt. Do not implicitly deduct payroll or settle an unrelated existing source document.

“авлага өглөгөөс хасах үйлдэл банкны гүйлгээнд оруулах”

**Why:** The user separately requested repayment of existing debt from bank transactions, not only creation of new debt.

**How to apply:** Keep explicit actions for creation versus repayment. Incoming funds repay a chosen receivable; outgoing funds repay a chosen payable. Repayment must not become another operating expense or a payroll deduction. The accountant explicitly chooses the existing debt; a GL classification alone is not authorization to reduce its balance.
