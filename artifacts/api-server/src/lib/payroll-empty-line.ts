import type { employeesTable } from "@workspace/db";

/** Explicitly uncalculated/zero-earnings shell; consumers must show calculationReady=false as a draft. */
export function emptyPayrollEarnings(employee: typeof employeesTable.$inferSelect) {
  return {
    employeeId: employee.id, employeeName: employee.name, bankAccountNumber: employee.bankAccountNumber ?? "",
    role: employee.role, employeeType: employee.employeeType, daysWorked: 0, hours: 0,
    gross: 0, socialInsuranceSalary: 0, socialInsurance: 0, taxableIncome: 0,
    calculatedIncomeTax: 0, taxRelief: 0, incomeTax: 0,
  };
}
