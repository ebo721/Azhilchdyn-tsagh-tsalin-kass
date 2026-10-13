---
name: Inventory closing scope
description: Shortage-only stock-count discrepancies and the distinction between last-price estimates and FIFO issues.
---

Эцсийн үлдэгдэлд огноо, бодит тоо хэмжээ, хариуцагч оруулна. Үнэ сүүлд авсан үнээр автоматаар бодогдоно. Зөвхөн дутагдал баталгаажаагүй зарлага үүсгэнэ; илүүдэл анхааруулга гаргаж, зарлага үүсгэхгүй. Баталгаажуулах хүртэл үлдэгдэл өөрчлөгдөхгүй.

**Why:** The user explicitly chose shortage-only discrepancies and no stock effect before approval.

**How to apply:** Preserve these rules when changing count entry, issue lists, or confirmation behavior.

Count values and pending shortage estimates use the latest purchase price on or before the selected date. If only opening stock exists, show its price and source explicitly; an unknown price must not silently become zero. Confirmed shortage issues retain the existing FIFO cost, which can differ from the estimate.

**Why:** The requested automatic last-price valuation should not change the costing method of ordinary inventory issues or fabricate a purchase price.

**How to apply:** Label pending estimates and confirmed FIFO cost distinctly. Preserve saved responsibility names even if an employee is later renamed or removed.
