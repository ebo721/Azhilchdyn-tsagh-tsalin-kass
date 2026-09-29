---
name: Bank recognition settlement boundary
description: The accounting boundary between bank GL suggestions and purchase or expense payment settlement.
---

Bank recognition may suggest the GL account from a matching unpaid purchase or operating expense. Generic bank-journal posting must not mark that source paid. An explicit source-backed approval or manual link must instead use the dedicated purchase/expense link flow, which atomically settles the source, claims the bank row, creates the cash mirror, and posts the journal.

**Why:** Recognition alone is not sufficient evidence to mutate payment state, but the user explicitly chose bidirectional linking when they confirm a specific source document.

**How to apply:** Keep generic GL classification and explicit document linking as separate actions. Source-backed approval must call the dedicated link flow; never make the generic post-journal endpoint settle documents.

When an accountant selects an operating-expense GL account for a bank expense in the journal-review UI, guide them to confirm an existing or new operating-expense document before posting. Salary and social-insurance accounts belong to payroll, not operating expenses. Keep direct GL-only posting available for classifications that are neither operating expenses nor inventory/supply purchases, and label it clearly as journal-only.

**Why:** The user expects a bank-funded operating expense to appear in Cash and Operating Expenses as well as the journal. Automatically creating an expense from every GL suggestion could duplicate an existing unpaid document or misclassify a purchase, while an unqualified journal-only action leaves those source lists empty.

**How to apply:** Reuse the source-backed expense-link flow for confirmed expense documents, preserving one linked settlement and one posted journal. For historical journal-only entries, inspect the business source and reverse/relink intentionally; do not backfill all entries by GL account alone.

For a bank expense still classified to inventory or supplies (1500/1510), require an existing or newly created inventory purchase even if the caller tries another document-link endpoint. A genuinely different business source must be deliberately reclassified first.

**Why:** Expense and fixed-asset link routes can settle the same bank row without a purchase record; guarding only direct journal/cash routes would leave the document requirement bypassable.

**How to apply:** Enforce this at every bank-settlement entry point before writing cash, journals, or source documents. Keep the UI on the purchase path for those classifications.