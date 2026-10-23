/** Keep the original two slots and cash source keys stable for existing links. */
export type AdditionalPayrollPayment = { sequence: number; amount: number; date: string };
type PaymentSource = {
  paidAmount?: number | string;
  paymentDate?: string | null;
  secondPaidAmount?: number | string;
  secondPaymentDate?: string | null;
  additionalPayments?: AdditionalPayrollPayment[];
};

export function payrollPayments(source: PaymentSource | undefined) {
  return [
    { sequence: 1, amount: Number(source?.paidAmount ?? 0), date: source?.paymentDate ?? null },
    { sequence: 2, amount: Number(source?.secondPaidAmount ?? 0), date: source?.secondPaymentDate ?? null },
    ...(source?.additionalPayments ?? []),
  ];
}

export function payrollPaymentSourceKey(month: string, employeeId: number, sequence: number) {
  return `${month}:${employeeId}${sequence === 1 ? "" : `:${sequence}`}`;
}
