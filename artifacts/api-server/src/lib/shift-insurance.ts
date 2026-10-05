export class PayrollConfigurationError extends Error {}

type ShiftInsuranceSettings = {
  employeeType: string;
  salaryType: string | undefined;
  socialInsuranceSalary: number;
  payrollTaxExempt: boolean;
  monthlyExpectedWorkDays: number;
};

export function needsShiftWorkDays(settings: ShiftInsuranceSettings) {
  return settings.employeeType === "shift"
    && (settings.salaryType === "monthly"
      || (!settings.payrollTaxExempt && settings.socialInsuranceSalary > 0));
}

/** The insured amount is always a MONTHLY base, including daily-paid workers. */
export function shiftInsuredDailySalary(
  settings: ShiftInsuranceSettings,
  employeeName: string,
  effectiveDate: string,
) {
  if (settings.payrollTaxExempt || settings.socialInsuranceSalary <= 0) return 0;
  if (!Number.isInteger(settings.monthlyExpectedWorkDays) || settings.monthlyExpectedWorkDays <= 0) {
    throw new PayrollConfigurationError(
      `${employeeName}: ${effectiveDate}-нд хүчинтэй цалингийн түүхийн «Сард ажиллах ёстой хоног»-ийг оруулна уу. НДШ-ийн сарын цалинг энэ хоногт хувааж бодно.`,
    );
  }
  return settings.socialInsuranceSalary / settings.monthlyExpectedWorkDays;
}
