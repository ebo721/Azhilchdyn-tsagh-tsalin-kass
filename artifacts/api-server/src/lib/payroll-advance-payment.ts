type PayrollAdvanceLine = Record<string, unknown>;

type PlanPayrollAdvancePaymentInput = {
  month: string;
  employeeId: number;
  advanceAmount: number;
  paid: boolean;
  paymentDate?: string | null;
};

export type PayrollAdvancePaymentPlan = {
  lines: PayrollAdvanceLine[];
  totalAmount: number;
  selectedLine: PayrollAdvanceLine | undefined;
  cashTransaction: {
    sourceType: "payroll_advance";
    sourceKey: string;
    amount: number;
    date: string;
  } | null;
};

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function planPayrollAdvancePayment(
  sourceLines: PayrollAdvanceLine[],
  input: PlanPayrollAdvancePaymentInput,
): PayrollAdvancePaymentPlan {
  const lines: PayrollAdvanceLine[] = sourceLines.map((line): PayrollAdvanceLine => (
    Number(line.employeeId) === input.employeeId
      ? {
          ...line,
          advanceAmount: money(input.advanceAmount),
          paid: input.paid,
          paymentDate: input.paid ? input.paymentDate : null,
        }
      : {
          ...line,
          paid: line.paid === true,
          paymentDate: typeof line.paymentDate === "string" ? line.paymentDate : null,
        }
  ));
  const selectedLine = lines.find((line) => Number(line.employeeId) === input.employeeId);
  const totalAmount = money(lines.reduce(
    (total, line) => total + Number(line.advanceAmount),
    0,
  ));
  const cashTransaction = selectedLine && input.paid && input.paymentDate
    ? {
        sourceType: "payroll_advance" as const,
        sourceKey: `${input.month}:${input.employeeId}`,
        amount: Number(selectedLine.advanceAmount),
        date: input.paymentDate,
      }
    : null;

  return { lines, totalAmount, selectedLine, cashTransaction };
}