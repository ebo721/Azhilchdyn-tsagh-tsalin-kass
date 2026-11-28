---
name: Payroll installment scope
description: Business expectations for salary paid in smaller amounts across three or more transfers.
---

Цалинг бага дүнгээр, 3 болон түүнээс олон хувааж олгож болно. Хэсэг бүрийг өөрийн банкны гүйлгээтэй холбож, төлөгдөөгүй хэсгийг цалингийн үлдэгдэлд хэвээр үлдээнэ.

**Why:** The user approved extending salary payments beyond the previous two-payment limit after asking how to reconcile smaller and split transfers.

**How to apply:** Do not reduce earned salary to match a partial transfer, combine separate bank transfers into a fictitious payment, or renumber existing installments when another is removed. Preserve historical bank and journal links.

Банкны гүйлгээг бодогдсон цалинд дутуу дүнгээр шууд холбоно. Дутуу хэсэг нь цалингийн өглөг болж үлдэж, дараагийн банкны гүйлгээг тэр үлдэгдэлд холбоод хаана. Урьдчилж цалин дээр төлөлт хувааж шивэхийг шаардахгүй.

**Why:** The user clarified this as the desired flow, rather than manually creating installments before bank reconciliation.

**How to apply:** Select the employee and saved payroll month from the bank transaction. Read amount and date from the bank, reuse an existing recorded payment when applicable, and keep debt within payroll's live saved-balance projection rather than creating a second generic payable.

Урьдчилгааны батлагдсан дүн нь бодитоор олгосон дүн биш. Хэсэгчлэн олгосон урьдчилгааны зөвхөн бодит төлөлтүүд болон баталгаажуулсан авлагын суутгалыг сүүл цалингаас тооцно.

**Why:** The user requested extending direct bank installments to approved advances while preserving prior single-payment links.

**How to apply:** Keep approved advance totals and actual disbursements distinct in every salary read, balance rebuild, and payable projection. Removing a bank link alone retains the recorded payment; cancelling an installment is a separate protected action.

Урьдчилгаа олгохдоо «Авлага» хэсэгт бүртгэсэн тухайн ажилтны авлагаас сонгож суутгана; цалингийн илүү олголтын авлага энэ хүсэлтийн хүрээнд хамаарахгүй.

**Why:** The user explicitly selected registered receivables when asked which employee debt should be deducted.

**How to apply:** Separate non-cash receivable settlement from actual cash transfers. For a 500,000₮ advance with a 100,000₮ settlement, cash totals 400,000₮ and final payroll accounts for 500,000₮ once, not a second manual deduction. Reversal restores receivable debt without inventing cash.

Урьдчилгаа цалингийн нээлттэй хүснэгтэд идэвхгүй болон тухайн урьдчилгааны хугацаанд огт ажиллаагүй ажилтан харагдахгүй. Ажилтны дансны дугаарыг тусдаа баганад харуулна.

**Why:** The user explicitly reported inactive and unworked staff appearing in advances and requested an account-number column.

**How to apply:** Ordinary office staff need present/late attendance too; an effective guaranteed-salary exception remains eligible without attendance. Apply the same roster rule when approving saved drafts so hidden legacy rows are not approved. Filtering is not permission to delete approved payments, recalculate saved earnings, or rewrite closed months. This active-status restriction applies to open advances, not to historical monthly payroll's date-based employment coverage.
