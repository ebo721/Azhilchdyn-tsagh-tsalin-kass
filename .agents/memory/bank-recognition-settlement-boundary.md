---
name: Bank recognition settlement boundary
description: The accounting boundary between bank GL suggestions and purchase or expense payment settlement.
---

Bank recognition may suggest the GL account from a matching unpaid purchase or operating expense. Generic bank-journal posting must not mark that source paid. An explicit source-backed approval or manual link must instead use the dedicated purchase/expense link flow, which atomically settles the source, claims the bank row, creates the cash mirror, and posts the journal.

**Why:** Recognition alone is not sufficient evidence to mutate payment state, but the user explicitly chose bidirectional linking when they confirm a specific source document.

**How to apply:** Keep generic GL classification and explicit document linking as separate actions. Source-backed approval must call the dedicated link flow; never make the generic post-journal endpoint settle documents.