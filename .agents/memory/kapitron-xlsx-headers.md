---
name: Kapitron XLSX headers
description: External statement-format behavior that the Kapitron importer must tolerate.
---

Kapitron statement exports can place account metadata, balances, blank rows, and a title before the transaction table. Locate the row containing the complete required transaction header rather than assuming the first worksheet row is the header.

**Why:** A September 2026 export moved the unchanged transaction columns to row 10, causing a valid statement to fail the importer’s first-row header check.

**How to apply:** Keep header matching exact enough to reject unrelated spreadsheets, but allow the complete header row to appear after a bounded number of preamble rows. Continue applying row and XML size limits.