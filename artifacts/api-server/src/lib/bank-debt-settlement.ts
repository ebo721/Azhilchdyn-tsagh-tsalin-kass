import { JournalValidationError, type ReceivableAllocationInput, type PayableAllocationInput } from "./journal-posting.js";

type Allocation = ReceivableAllocationInput | PayableAllocationInput;
type Settlement = { amount: number; receivableId?: number; payableId?: number };
type Repayment = { amount: number; allocation: Extract<Allocation, { kind: "settle" }> };

export const moneyCents = (amount: number) => Math.round(amount * 100);

/** Do not round user-entered fractions away: every allocation must be valid money. */
export function validateBankSettlements(settlements: Settlement[] | undefined, allocation: Allocation | undefined, raw: unknown) {
  if (!settlements) return;
  if (allocation) throw new JournalValidationError("Хуваарилалт болон нэг өрийн бүртгэлийг хамт илгээж болохгүй");
  const seen = new Set<string>();
  for (const item of settlements) {
    const key = item.receivableId !== undefined ? `r:${item.receivableId}` : `p:${item.payableId}`;
    if ((item.receivableId === undefined) === (item.payableId === undefined) || seen.has(key)) {
      throw new JournalValidationError("Мөр бүрт нэг авлага эсвэл өглөг сонгоно уу; нэг өрийг давхар сонгож болохгүй");
    }
    if (!Number.isSafeInteger(moneyCents(item.amount)) || item.amount <= 0
      || Math.abs(item.amount * 100 - moneyCents(item.amount)) > 0.000001) {
      throw new JournalValidationError("Хуваарилалтын дүн эерэг, бутархайн хоёр оронтой байна");
    }
    seen.add(key);
  }
  // Zod strips unknown properties; reject create/party metadata rather than silently discarding it.
  if (!Array.isArray(raw) || raw.some(item => !item || Object.keys(item).some(key => !["amount", "receivableId", "payableId"].includes(key)))) {
    throw new JournalValidationError("Төлөлтийн мөр зөвхөн өр болон дүн агуулна");
  }
}

export function bankRepayments(
  settlements: Settlement[] | undefined, allocation: Allocation | undefined, amount: number, type: string,
): Repayment[] {
  const rows: Repayment[] = settlements
    ? settlements.map(item => ({
      amount: item.amount,
      allocation: item.receivableId !== undefined
        ? { kind: "settle", receivableId: item.receivableId }
        : { kind: "settle", payableId: item.payableId! },
    }))
    : allocation?.kind === "settle" ? [{ amount, allocation }] : [];
  if (rows.length && (rows.some(row => type === "income" ? !("receivableId" in row.allocation) : !("payableId" in row.allocation))
    || rows.reduce((sum, row) => sum + moneyCents(row.amount), 0) !== moneyCents(amount))) {
    throw new JournalValidationError("Хуваарилалтын чиглэл зөв, нийлбэр банкны хадгалсан дүнтэй яг тэнцүү байна");
  }
  // Consistent debt lock order across payments (also retained in journal line order for cancellation).
  return rows.sort((a, b) => targetId(a.allocation) - targetId(b.allocation));
}

function targetId(allocation: Repayment["allocation"]) {
  return "receivableId" in allocation ? allocation.receivableId : allocation.payableId;
}

export function matchesBankRepayments(
  rows: Repayment[], existing: { allocation: unknown; debit: number; credit: number }[], type: string,
) {
  if (rows.length !== existing.length) return false;
  return rows.every(row => existing.some(line => {
    const prior = line.allocation as Repayment["allocation"] | null;
    return prior?.kind === "settle"
      && ("receivableId" in row.allocation
        ? "receivableId" in prior && prior.receivableId === row.allocation.receivableId && !("payableId" in prior)
        : "payableId" in prior && prior.payableId === row.allocation.payableId && !("receivableId" in prior))
      && moneyCents(Number(type === "income" ? line.credit : line.debit)) === moneyCents(row.amount);
  }));
}
