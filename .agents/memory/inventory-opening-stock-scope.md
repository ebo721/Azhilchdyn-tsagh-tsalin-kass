---
name: Historical opening stock scope
description: Why opening inventory is separate from purchases and accounting settlement.
---

Historical opening stock adds to inventory quantity and FIFO value; do not silently turn it into a new purchase, supplier debt, or cash/bank payment.

**Why:** The request was to enter previously owned inventory by quantity and price. No source payable, settlement, or general-ledger counteraccount was supplied. Inventing those would misstate historical finances.

**How to apply:** Keep inventory opening entries distinct from purchasing. General-ledger opening journals are separate accounting scope; agree on their counteraccount and existing financial opening balances before linking them.

Барааны дэлгэрэнгүйд бүх сарын худалдан авалтын түүх болон эхний үлдэгдлийг тусад нь харуулна.

**Why:** The user approved fixing stock-item details that incorrectly reported no history when purchases fell outside the month selected in the purchase list.

**How to apply:** Purchase-list month, material-type, and pagination filters must not restrict an individual item's history. Label historical opening stock separately, never as a purchase.

Худалдан авалт бүрийн баримтын дугаар `он/сар/өдөр/001` байна. Огноо нь худалдан авалтын сонгосон огноо; тухайн өдрийн эхний шивэлт 1-ээс эхэлнэ. Барааны үлдэгдэл харахад баримтын дугаар харагдана.

**Why:** The user explicitly chose the purchase's selected date rather than the system entry date for daily numbering.

**How to apply:** Display source purchase numbers on stock and individual purchase history. Do not invent purchase numbers for historical opening stock.
