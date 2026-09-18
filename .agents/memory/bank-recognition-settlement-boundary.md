---
name: Bank recognition settlement boundary
description: The accounting boundary between bank GL suggestions and purchase or expense payment settlement.
---

Bank recognition may suggest the GL account from a matching unpaid purchase or operating expense, but bank-journal approval must remain generic and must not mark that source document paid or link it as settled.

**Why:** The user explicitly chose account classification only. A probabilistic or rule-based suggestion is not sufficient evidence to mutate the payment lifecycle of the source document.

**How to apply:** Preserve this boundary when changing bank import recognition, journal-review approval, or purchase and expense payment flows. Settlement requires its dedicated confirmation flow.