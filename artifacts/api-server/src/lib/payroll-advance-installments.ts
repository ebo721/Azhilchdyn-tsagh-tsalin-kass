import { money } from "./date-utils.js";

type AdvanceSource = {
  advanceAmount?: unknown;
  paid?: unknown;
  paymentDate?: unknown;
  payments?: unknown;
};
export type AdvanceInstallment = { sequence: number; amount: number; date: string };

/** Legacy payments retain slot 1 and its unsuffixed cash source key. */
export function advancePayments(line: AdvanceSource): AdvanceInstallment[] {
  if (Array.isArray(line.payments)) return line.payments as AdvanceInstallment[];
  return line.paid === true && Number(line.advanceAmount) > 0 && typeof line.paymentDate === "string"
    ? [{ sequence: 1, amount: Number(line.advanceAmount), date: line.paymentDate }] : [];
}

export function advancePaidAmount(line: AdvanceSource) {
  // Older paid snapshots may not include a payment date.
  return money(Array.isArray(line.payments)
    ? advancePayments(line).reduce((sum, payment) => sum + payment.amount, 0)
    : line.paid === true ? Number(line.advanceAmount) : 0);
}

export function advanceFinancials<T extends AdvanceSource>(line: T) {
  const paidAmount = advancePaidAmount(line);
  return { ...line, paidAmount, remainingBalance: money(Math.max(0, Number(line.advanceAmount) - paidAmount)) };
}
