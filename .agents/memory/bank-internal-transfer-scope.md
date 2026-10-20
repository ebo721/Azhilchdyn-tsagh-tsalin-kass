---
name: Bank internal transfer scope
description: The user's distinction between two real bank accounts and physical cash, and first-stage transfer accounting boundaries.
---

The company imports statements from two real bank accounts: a current account and a “кассын данс”. The latter is still a bank account, not physical cash (1000). Preserve the existing cash-top-up rule to 1000.

**Why:** Transfers between these two bank accounts must not be treated as revenue or operating expenses merely because the receiving account is called “кассын данс”.

**How to apply:** Let users explicitly confirm one outgoing/incoming pair; suggestions are not permission to auto-pair. First-stage pairing records only the relationship and any amount difference as a fee, with no journal or fee expense. Separate bank GL codes, automatic pairing and one-to-many transfers require a separate request.
