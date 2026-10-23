import { GetPayrollAdvanceResponse } from "@workspace/api-zod";
import { PayrollSnapshotMissingError } from "./payroll-attendance-snapshot.js";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import {
  payrollAttendanceSnapshotsTable,
  payrollMonthClosuresTable,
  attendanceTable,
  db,
  employeesTable,
  employeeSalaryHistoryTable,
  payrollAdjustmentsTable,
  payrollAdvanceApprovalsTable,
  payrollScheduleSettingsTable,
} from "@workspace/db";
import { currentMonth, daysInMonth, money, nextMonth, previousMonth } from "./date-utils.js";
import { PayrollConfigurationError, shiftInsuredDailySalary } from "./shift-insurance.js";
import { defaultPayrollSchedule, scheduleDate, weekdayDatesBetween, type PayrollCalculationData, type SalaryHistoryRow, type DbClient } from "./route-shared.js";
import { readMonthlyPayroll } from "./payroll-balance-store.js";

export const monthlyIncomeTaxRelief = (socialInsuranceSalary: number) => {
  if (socialInsuranceSalary <= 500_000) return 20_000;
  if (socialInsuranceSalary <= 1_000_000) return 18_000;
  if (socialInsuranceSalary <= 1_500_000) return 16_000;
  if (socialInsuranceSalary <= 2_000_000) return 14_000;
  if (socialInsuranceSalary <= 2_500_000) return 12_000;
  if (socialInsuranceSalary <= 3_000_000) return 10_000;
  return 0;
};

export async function getPayrollSchedule(month = currentMonth(), connection: DbClient = db) {
  let [row] = await connection.select().from(payrollScheduleSettingsTable)
    .where(lte(payrollScheduleSettingsTable.effectiveFromMonth, month))
    .orderBy(desc(payrollScheduleSettingsTable.effectiveFromMonth))
    .limit(1);
  if (!row) {
    [row] = await connection.insert(payrollScheduleSettingsTable)
      .values({ ...defaultPayrollSchedule, effectiveFromMonth: "0001-01" })
      .onConflictDoNothing({ target: payrollScheduleSettingsTable.effectiveFromMonth })
      .returning();
    if (!row) {
      [row] = await connection.select().from(payrollScheduleSettingsTable)
        .where(eq(payrollScheduleSettingsTable.effectiveFromMonth, "0001-01")).limit(1);
    }
  }
  return row;
}

export function payrollPeriod(month: string, schedule: typeof defaultPayrollSchedule) {
  const startMonth = schedule.periodStartDay > schedule.periodEndDay ? previousMonth(month) : month;
  const finalPaymentMonth = schedule.finalPayDay < schedule.advancePayDay ? nextMonth(month) : month;
  const periodStart = scheduleDate(startMonth, schedule.periodStartDay);
  const periodEnd = scheduleDate(month, schedule.periodEndDay);
  const advancePeriodEnd = schedule.advanceCutoffDay >= schedule.periodStartDay
    ? scheduleDate(startMonth, schedule.advanceCutoffDay)
    : scheduleDate(month, schedule.advanceCutoffDay);
  return {
    periodStart,
    advancePeriodEnd,
    periodEnd,
    advancePaymentDate: scheduleDate(month, schedule.advancePayDay),
    finalPaymentDate: scheduleDate(finalPaymentMonth, schedule.finalPayDay),
  };
}

export function shiftDailyRate(salary: Pick<SalaryHistoryRow, "salaryType" | "baseSalary" | "monthlyExpectedWorkDays">) {
  return salary.salaryType === "monthly"
    ? Number(salary.baseSalary) / Math.max(1, salary.monthlyExpectedWorkDays)
    : Number(salary.baseSalary);
}

export function salaryAt(employee: typeof employeesTable.$inferSelect, history: SalaryHistoryRow[], date: string) {
  const employeeHistory = history.filter((row) => row.employeeId === employee.id)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const latest = employeeHistory[0];
  if (!latest) {
    throw new PayrollConfigurationError(
      `${employee.name}: ${date}-нд НДШ/ХХОАТ төлөх эсэхийг шалгах цалингийн түүх алга. Ажилтны бүртгэлд хүчинтэй эхлэх огноо, татварын төлөвийг бүртгэнэ үү. Одоогийн тохиргоогоор таамгаар бодохгүй.`,
    );
  }
  // The employee register mirrors the latest saved salary-history row, even
  // when that row starts in the future. Compare those two, not the historical
  // row for this calculation date: a later exemption must not rewrite the past.
  if (latest.payrollTaxExempt !== employee.payrollTaxExempt) {
    throw new PayrollConfigurationError(
      `${employee.name}: ажилтны бүртгэл болон ${latest.effectiveFrom}-нөөс хүчинтэй хамгийн сүүлийн цалингийн түүхийн НДШ/ХХОАТ төлөх төлөв зөрүүтэй байна. Бүртгэлийг тулгаж залруулсны дараа цалин бодно уу.`,
    );
  }
  const effective = employeeHistory.find((row) => row.effectiveFrom <= date);
  if (effective) return effective;
  // A known history with no coverage is not permission to apply today's
  // salary/tax settings backwards. Nor can we infer an earlier exemption from
  // a later row. Require an explicit historical correction before saving pay.
  const firstDate = employeeHistory[employeeHistory.length - 1].effectiveFrom;
  throw new PayrollConfigurationError(
    `${employee.name}: ${date}-нд хүчинтэй цалингийн түүх алга. Анхны түүх ${firstDate}-нөөс эхэлж байна. Цалингийн түүхийн эхлэх огноо, НДШ/ХХОАТ-ын чөлөөлөлтийг шалгаж залруулна уу. Одоогийн тохиргоог өмнөх хугацаанд ашиглаж бодохгүй.`,
  );
}

export function applyPayrollFinancials(
  base: { gross: number; socialInsurance: number; incomeTax: number },
  adjustment: typeof payrollAdjustmentsTable.$inferSelect | undefined,
  advanceAmount: number,
  carryoverAmount: number,
) {
  const manualDeduction = money(Number(adjustment?.manualDeduction ?? 0));
  const firstPaidAmount = money(Number(adjustment?.paidAmount ?? 0));
  const secondPaidAmount = money(Number(adjustment?.secondPaidAmount ?? 0));
  const additionalPayments = adjustment?.additionalPayments ?? [];
  const paidAmount = money(firstPaidAmount + secondPaidAmount
    + additionalPayments.reduce((total, payment) => total + payment.amount, 0));
  const deductions = money(base.socialInsurance + base.incomeTax + advanceAmount + manualDeduction);
  const payableBeforePayment = money(base.gross - deductions + carryoverAmount);
  const payable = money(Math.max(0, payableBeforePayment));
  const rawBalanceAmount = payableBeforePayment - paidAmount;
  const balanceAmount = money(Math.abs(rawBalanceAmount) <= 1 ? 0 : rawBalanceAmount);
  return {
    advanceAmount, manualDeduction, receivableId: adjustment?.receivableId ?? null, deductions,
    carryoverAmount, payable, paidAmount, paymentDate: adjustment?.paymentDate ?? null,
    secondPaidAmount, secondPaymentDate: adjustment?.secondPaymentDate ?? null,
    additionalPayments,
    remainingAmount: money(Math.max(0, balanceAmount)), overpaidAmount: money(Math.max(0, -balanceAmount)),
    balanceAmount, net: payable,
  };
}

export function payrollSummaryTotals(lines: Array<{ gross: number; socialInsurance: number; incomeTax: number; deductions: number; net: number }>) {
  return {
    totalGross: money(lines.reduce((total, line) => total + line.gross, 0)),
    totalSocialInsurance: money(lines.reduce((total, line) => total + line.socialInsurance, 0)),
    totalIncomeTax: money(lines.reduce((total, line) => total + line.incomeTax, 0)),
    totalDeductions: money(lines.reduce((total, line) => total + line.deductions, 0)),
    totalNet: money(lines.reduce((total, line) => total + line.net, 0)),
  };
}

export async function getPayrollSummary(month: string, existingData?: PayrollCalculationData) {
  if (!existingData) return readMonthlyPayroll(month);
  return calculatePayrollMonth(month, existingData, await getPayrollSchedule(month));
}

/** One month only. Historical carryover comes from financial records, never from attendance. */
export function calculatePayrollMonth(
  month: string,
  data: PayrollCalculationData,
  rawSchedule: typeof payrollScheduleSettingsTable.$inferSelect,
) {
  const { allEmployees, salaryHistory, records } = data;
  const schedule = {
    effectiveFromMonth: rawSchedule.effectiveFromMonth,
    id: rawSchedule.id,
    periodStartDay: rawSchedule.periodStartDay,
    advanceCutoffDay: rawSchedule.advanceCutoffDay,
    periodEndDay: rawSchedule.periodEndDay,
    advancePayDay: rawSchedule.advancePayDay,
    finalPayDay: rawSchedule.finalPayDay,
  };
  const period = payrollPeriod(month, schedule);
  const adjustments = data.allAdjustments.filter((row) => row.month === month);
  const advanceApprovals = data.allAdvanceApprovals.filter((row) => row.month === month);
  const monthStart = period.periodStart;
  const monthEnd = period.periodEnd;
  const employees = allEmployees.filter((employee) =>
    employee.joinedAt <= monthEnd && (!employee.inactiveAt || employee.inactiveAt >= monthStart)
  );
  const previousLineMap = new Map(data.openingBalances?.map(line => [line.employeeId, line]) ?? []);
  const weekdays = weekdayDatesBetween(period.periodStart, period.periodEnd);
  const monthRecords = records.filter((record) => String(record.date) >= period.periodStart && String(record.date) <= period.periodEnd);
  const adjustmentMap = new Map(adjustments.map((adjustment) => [adjustment.employeeId, adjustment]));
  const approvedAdvanceLines = Array.isArray(advanceApprovals[0]?.lines)
    ? advanceApprovals[0].lines as Array<{ employeeId: number; advanceAmount: number; paid?: boolean }>
    : [];
  const paidAdvanceMap = new Map(
    approvedAdvanceLines
      .filter((line) => line.paid === true)
      .map((line) => [line.employeeId, Number(line.advanceAmount)]),
  );

  const lines = employees.map((employee) => {
    const employeeRecords = monthRecords.filter((record) => record.employeeId === employee.id);
    const eligibleWeekdays = weekdays.filter((date) =>
      date >= employee.joinedAt && (!employee.inactiveAt || date <= employee.inactiveAt)
    );
    const employeeHistory = salaryHistory.filter(row => row.employeeId === employee.id)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    // Determine dated full-salary entitlement without treating uncovered,
    // attendance-free days as earning days or backdating a later exception.
    const fullSalaryDates = eligibleWeekdays.filter(date =>
      employeeHistory.find(row => row.effectiveFrom <= date)?.fullSalaryRegardlessAttendance === true);
    if (employeeRecords.length > 0
      || (employee.fullSalaryRegardlessAttendance && !employeeHistory.some(row =>
        row.effectiveFrom <= (employee.joinedAt > period.periodStart ? employee.joinedAt : period.periodStart)))) {
      salaryAt(employee, salaryHistory, employee.joinedAt > period.periodStart ? employee.joinedAt : period.periodStart);
    }
    const paidWeekdays = employeeRecords.length === 0
      ? []
      : eligibleWeekdays.filter((date) =>
          !employeeRecords.some((record) => String(record.date) === date && record.status === "leave")
        );
    const workedRecords = employeeRecords
      .filter((record) =>
        ["present", "late"].includes(record.status)
        && String(record.date) >= employee.joinedAt
        && (!employee.inactiveAt || String(record.date) <= employee.inactiveAt)
      )
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const daysWorked = workedRecords.length;
    const hours = money(workedRecords.reduce((total, record) => total + Number(record.hours), 0));
    // Weekend work is paid even when weekday leave keeps total attendance below
    // the month's weekday count. Use the same dates for earnings and insurance.
    const weekendWorkedRecords = workedRecords
      .filter((record) => !weekdays.includes(String(record.date)));
    const officeSalaryDates = eligibleWeekdays.filter(date =>
      fullSalaryDates.includes(date) || paidWeekdays.includes(date));
    const officeGross = officeSalaryDates.reduce((total, date) => {
      const salary = salaryAt(employee, salaryHistory, date);
      return total + (salary.employeeType === "office" ? Number(salary.baseSalary) / weekdays.length : 0);
    }, 0) + weekendWorkedRecords.reduce((total, record) => {
      const salary = salaryAt(employee, salaryHistory, String(record.date));
      return total + (salary.employeeType === "office" && !salary.fullSalaryRegardlessAttendance ? Number(salary.baseSalary) / weekdays.length : 0);
    }, 0);
    const fullShiftGross = fullSalaryDates.reduce((total, date) => {
      const salary = salaryAt(employee, salaryHistory, date);
        return total + (salary.employeeType === "shift" && salary.fullSalaryRegardlessAttendance
          ? (salary.salaryType === "monthly" ? Number(salary.baseSalary) : Number(salary.baseSalary) * salary.monthlyExpectedWorkDays) / weekdays.length
        : 0);
    }, 0);
    const attendedShiftGross = workedRecords
      .reduce((total, record) => {
        const salary = salaryAt(employee, salaryHistory, String(record.date));
        return total + (salary.employeeType === "shift" && !salary.fullSalaryRegardlessAttendance
          ? shiftDailyRate(salary)
          : 0);
      }, 0);
    const gross = money(officeGross + fullShiftGross + attendedShiftGross);
    const insuredSalaryDates = officeSalaryDates;
    const socialInsuranceSalary = money(insuredSalaryDates.reduce((total, date) => {
      const salary = salaryAt(employee, salaryHistory, date);
      return total + (salary.payrollTaxExempt
        || (salary.employeeType === "shift" && !salary.fullSalaryRegardlessAttendance)
        ? 0 : Number(salary.socialInsuranceSalary) / weekdays.length);
    }, 0) + weekendWorkedRecords.reduce((total, record) => {
      const salary = salaryAt(employee, salaryHistory, String(record.date));
      return total + (salary.payrollTaxExempt || salary.fullSalaryRegardlessAttendance || salary.employeeType !== "office"
        ? 0 : Number(salary.socialInsuranceSalary) / weekdays.length);
    }, 0) + workedRecords.reduce((total, record) => {
      const date = String(record.date);
      const salary = salaryAt(employee, salaryHistory, date);
      return total + (salary.employeeType === "shift" && !salary.fullSalaryRegardlessAttendance
        ? shiftInsuredDailySalary(salary, employee.name, date) : 0);
    }, 0));
    const payrollTaxExempt = socialInsuranceSalary === 0;
    const socialInsurance = payrollTaxExempt ? 0 : money(socialInsuranceSalary * 0.115);
    const taxableIncome = payrollTaxExempt ? 0 : money(Math.max(0, socialInsuranceSalary - socialInsurance));
    const adjustment = adjustmentMap.get(employee.id);
    const calculatedIncomeTax = payrollTaxExempt ? 0 : money(taxableIncome * 0.1);
    const taxRelief = payrollTaxExempt ? 0 : monthlyIncomeTaxRelief(socialInsuranceSalary);
    const incomeTax = payrollTaxExempt ? 0 : money(Math.max(0, calculatedIncomeTax - taxRelief));
    const financial = applyPayrollFinancials({ gross, socialInsurance, incomeTax }, adjustment,
      money(paidAdvanceMap.get(employee.id) ?? 0), money(previousLineMap.get(employee.id)?.balanceAmount ?? 0));
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      bankAccountNumber: employee.bankAccountNumber ?? "",
      role: employee.role,
      employeeType: employee.employeeType,
      daysWorked,
      hours,
      gross,
      socialInsuranceSalary,
      socialInsurance,
      taxableIncome,
      calculatedIncomeTax,
      taxRelief,
      incomeTax,
      ...financial,
    };
  });

  return {
    month,
    periodStart: period.periodStart,
    advancePeriodEnd: period.advancePeriodEnd,
    periodEnd: period.periodEnd,
    advancePaymentDate: period.advancePaymentDate,
    finalPaymentDate: period.finalPaymentDate,
    schedule,
    ...payrollSummaryTotals(lines),
    lines,
  };
}

export async function getPayrollAdvanceSummary(
  month: string,
  connection: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0] = db,
  { savedOnly = false, ignoreApproval = false, employeeId = undefined as number | undefined } = {},
) {
  const [closure] = await connection.select().from(payrollMonthClosuresTable).where(eq(payrollMonthClosuresTable.month, month));
  if (closure) return GetPayrollAdvanceResponse.parse(closure.advance);
  const [approval] = await connection.select().from(payrollAdvanceApprovalsTable)
    .where(eq(payrollAdvanceApprovalsTable.month, month));
  if (savedOnly && (!approval || ignoreApproval)) {
    const [snapshot] = await connection.select().from(payrollAttendanceSnapshotsTable)
      .where(eq(payrollAttendanceSnapshotsTable.month, month));
    if (!snapshot) {
      const { latestPayrollOpening } = await import("./payroll-opening.js");
      const baseline = await latestPayrollOpening(connection);
      if (!baseline || month <= baseline.month) throw new PayrollSnapshotMissingError(month);
      const schedule = await getPayrollSchedule(month, connection);
      return {
        month, ...payrollPeriod(month, schedule), schedule, approved: false, approvalDate: null,
        totalAmount: 0, lines: [],
      };
    }
    return GetPayrollAdvanceResponse.parse({ ...snapshot.advance, attendancePulledAt: snapshot.pulledAt.toISOString() });
  }
  const rawSchedule = await getPayrollSchedule(month, connection);
  const schedule = {
    effectiveFromMonth: rawSchedule.effectiveFromMonth,
    id: rawSchedule.id,
    periodStartDay: rawSchedule.periodStartDay,
    advanceCutoffDay: rawSchedule.advanceCutoffDay,
    periodEndDay: rawSchedule.periodEndDay,
    advancePayDay: rawSchedule.advancePayDay,
    finalPayDay: rawSchedule.finalPayDay,
  };
  const period = payrollPeriod(month, schedule);
  if (approval && !ignoreApproval) {
    const lines = Array.isArray(approval.lines)
      ? (approval.lines as Array<Record<string, unknown>>).map((line) => ({
          ...line,
          paid: line.paid === true,
          paymentDate: typeof line.paymentDate === "string" ? line.paymentDate : null,
        }))
      : [];
    return {
      month,
      periodStart: period.periodStart,
      advancePeriodEnd: period.advancePeriodEnd,
      periodEnd: period.periodEnd,
      advancePaymentDate: period.advancePaymentDate,
      finalPaymentDate: period.finalPaymentDate,
      schedule,
      approved: true,
      approvalDate: approval.approvalDate,
      approvedAt: approval.approvedAt.toISOString(),
      totalAmount: Number(approval.totalAmount),
      lines,
    };
  }
  const [allEmployees, records, salaryHistory] = await Promise.all([
    connection.select().from(employeesTable).where(employeeId ? eq(employeesTable.id, employeeId) : undefined),
    connection.select().from(attendanceTable).where(and(
      gte(attendanceTable.date, period.periodStart),
      lte(attendanceTable.date, period.advancePeriodEnd),
      employeeId ? eq(attendanceTable.employeeId, employeeId) : undefined,
    )),
    connection.select().from(employeeSalaryHistoryTable).where(employeeId ? eq(employeeSalaryHistoryTable.employeeId, employeeId) : undefined),
  ]);
  const employees = allEmployees.filter((employee) => {
    if (employee.joinedAt > period.advancePeriodEnd
      || (employee.inactiveAt && employee.inactiveAt < period.periodStart)) return false;
    // An empty period before the first salary row has no advance to draft.
    // Do not manufacture salary settings merely to decide payment frequency.
    const hasHistory = salaryHistory.some(row =>
      row.employeeId === employee.id && row.effectiveFrom <= period.advancePeriodEnd);
    const hasAttendance = records.some(row => row.employeeId === employee.id
      && String(row.date) >= employee.joinedAt
      && (!employee.inactiveAt || String(row.date) <= employee.inactiveAt));
    if (!hasHistory && !hasAttendance && !employee.fullSalaryRegardlessAttendance) return false;
    return salaryAt(employee, salaryHistory, period.advancePeriodEnd).payFrequency === "twice";
  });
  const firstHalfRecords = records.filter((record) =>
    String(record.date) >= period.periodStart && String(record.date) <= period.advancePeriodEnd
  );
  const lines = employees.map((employee) => calculatePayrollAdvanceLine(
    employee,
    firstHalfRecords,
    salaryHistory,
    period.periodStart,
    period.periodEnd,
    period.advancePeriodEnd,
  ));
  return {
    month,
    periodStart: period.periodStart,
    advancePeriodEnd: period.advancePeriodEnd,
    periodEnd: period.periodEnd,
    advancePaymentDate: period.advancePaymentDate,
    finalPaymentDate: period.finalPaymentDate,
    schedule,
    approved: false,
    approvalDate: null,
    totalAmount: money(lines.reduce((total, line) => total + line.advanceAmount, 0)),
    lines,
  };
}

export function calculatePayrollAdvanceLine(
  employee: typeof employeesTable.$inferSelect,
  records: Array<typeof attendanceTable.$inferSelect>,
  salaryHistory: SalaryHistoryRow[] = [],
  periodStart?: string,
  periodEnd?: string,
  advancePeriodEnd?: string,
) {
  const attendedRecords = records.filter((record) =>
    record.employeeId === employee.id
    && ["present", "late"].includes(record.status)
    && (!periodStart || String(record.date) >= periodStart)
    && (!advancePeriodEnd || String(record.date) <= advancePeriodEnd),
  );
  const daysWorked = attendedRecords.length;
  const salaryFor = (date: string) => salaryAt(employee, salaryHistory, date);
  const firstSalary = salaryFor(
    attendedRecords[0] ? String(attendedRecords[0].date) : (advancePeriodEnd ?? employee.joinedAt),
  );
  const officeSalary = salaryFor(advancePeriodEnd ?? employee.joinedAt);
  const effectiveEmployeeType = officeSalary.employeeType;
  const dailySalary = effectiveEmployeeType === "shift"
      ? money(shiftDailyRate(firstSalary))
    : 0;
  const totalSalary = effectiveEmployeeType === "shift"
    ? money(attendedRecords.reduce((total, record) => {
      const salary = salaryFor(String(record.date));
      const rate = shiftDailyRate(salary);
      return total + rate;
    }, 0))
    : money(Number(officeSalary.baseSalary));
  return {
    employeeId: employee.id,
    employeeName: employee.name,
    employeeType: effectiveEmployeeType,
    baseSalary: money(Number(officeSalary.baseSalary)),
    daysWorked,
    dailySalary,
    totalSalary,
    advanceAmount: effectiveEmployeeType === "shift" ? totalSalary : money(totalSalary * 0.5),
    paid: false,
    paymentDate: null,
  };
}