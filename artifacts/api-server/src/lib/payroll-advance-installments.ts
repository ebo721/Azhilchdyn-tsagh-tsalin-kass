import { money } from "./date-utils.js";

type AdvanceSource = {
  advanceAmount?: unknown;
  paid?: unknown;
  paymentDate?: unknown;
  payments?: unknown;
  receivableDeduction?: unknown;
};
export type AdvanceInstallment = { sequence: number; amount: number; date: string };

/** Legacy payments retain slot 1 and its unsuffixed cash source key. */
export function advancePayments(line: AdvanceSource): AdvanceInstallment[] {
  if (Array.isArray(line.payments)) return line.payments as AdvanceInstallment[];
  return line.paid === true && Number(line.advanceAmount) > 0 && typeof line.paymentDate === "string"
    ? [{ sequence: 1, amount: advanceNetAmount(line), date: line.paymentDate }].filter(p => p.amount > 0) : [];
}

export function advanceNetAmount(line: AdvanceSource) {
  return money(Math.max(0, Number(line.advanceAmount ?? 0) - Number(line.receivableDeduction ?? 0)));
}

export function advancePaidAmount(line: AdvanceSource) {
  // Older paid snapshots may not include a payment date.
  return money(Array.isArray(line.payments)
    ? advancePayments(line).reduce((sum, payment) => sum + payment.amount, 0)
    : line.paid === true ? advanceNetAmount(line) : 0);
}

/** Cash paid plus receivable settled: deduct this total once from final salary. */
export function advanceSettledAmount(line: AdvanceSource) {
  return money(advancePaidAmount(line) + Number(line.receivableDeduction ?? 0));
}

export function advanceFinancials<T extends AdvanceSource>(line: T) {
  const paidAmount = advancePaidAmount(line);
  return { ...line, paidAmount, netAdvanceAmount: advanceNetAmount(line),
    remainingBalance: money(Math.max(0, advanceNetAmount(line) - paidAmount)) };
}
