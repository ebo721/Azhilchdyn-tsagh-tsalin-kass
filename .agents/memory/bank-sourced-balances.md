---
name: Bank-sourced balance scope
description: User-required dates and financial meaning of creating new receivables/payables from bank transactions.
---

“банкны гүйлгээнээс шууд авлага/өглөг үүсгэж болдог байх, тухайн гүйлгээний огноогоор автоматаар үүсгэнэ.”

**Why:** The user explicitly asked for direct bank-sourced debt registration using the transaction date, not the date the accountant enters it.

**How to apply:** Take date and amount from the stored bank transaction, not editable client values. Creating new debt differs from repayment: outgoing bank funds create a receivable; incoming borrowed/held funds create a payable. Use the existing journal allocation lifecycle so a retry cannot produce another debt. Do not implicitly deduct payroll or settle an unrelated existing source document.
