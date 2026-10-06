import { and, desc, eq, gte, lte } from "drizzle-orm";
import {
  attendanceTable,
  db,
  employeesTable,
  employeeSalaryHistoryTable,
  payrollAdjustmentsTable,
  payrollAdvanceApprovalsTable,
  payrollScheduleSettingsTable,
} from "@workspace/db";
import { currentMonth, daysInMonth, money, nextMonth, previousMonth } from "./date-utils.js";
import { shiftInsuredDailySalary } from "./shift-insurance.js";
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
  return history
    .filter((row) => row.employeeId === employee.id && row.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? {
      employeeId: employee.id,
      effectiveFrom: employee.joinedAt,
      employeeType: employee.employeeType,
      salaryType: employee.salaryType === "hourly" ? "daily" : employee.salaryType,
      monthlyExpectedWorkDays: employee.monthlyExpectedWorkDays,
      baseSalary: Number(employee.baseSalary),
      socialInsuranceSalary: Number(employee.socialInsuranceSalary),
      payrollTaxExempt: employee.payrollTaxExempt,
      fullSalaryRegardlessAttendance: employee.fullSalaryRegardlessAttendance,
      payFrequency: employee.payFrequency,
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
    const excessWorkedDayCount = Math.max(0, workedRecords.length - eligibleWeekdays.length);
    const excessWorkedRecords = workedRecords
      .filter((record) => !eligibleWeekdays.includes(String(record.date)))
      .slice(0, excessWorkedDayCount);
    const officeSalaryDates = eligibleWeekdays.filter((date) => {
      const salary = salaryAt(employee, salaryHistory, date);
      return salary.fullSalaryRegardlessAttendance || paidWeekdays.includes(date);
    });
    const officeGross = officeSalaryDates.reduce((total, date) => {
      const salary = salaryAt(employee, salaryHistory, date);
      return total + (salary.employeeType === "office" ? Number(salary.baseSalary) / weekdays.length : 0);
    }, 0) + excessWorkedRecords.reduce((total, record) => {
      const salary = salaryAt(employee, salaryHistory, String(record.date));
      return total + (salary.employeeType === "office" && !salary.fullSalaryRegardlessAttendance ? Number(salary.baseSalary) / weekdays.length : 0);
    }, 0);
    const fullShiftGross = eligibleWeekdays.reduce((total, date) => {
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
    const insuredSalaryDates = eligibleWeekdays.filter((date) => {
      const salary = salaryAt(employee, salaryHistory, date);
      return salary.fullSalaryRegardlessAttendance || paidWeekdays.includes(date);
    });
    const socialInsuranceSalary = money(insuredSalaryDates.reduce((total, date) => {
      const salary = salaryAt(employee, salaryHistory, date);
      return total + (salary.payrollTaxExempt
        || (salary.employeeType === "shift" && !salary.fullSalaryRegardlessAttendance)
        ? 0 : Number(salary.socialInsuranceSalary) / weekdays.length);
    }, 0) + excessWorkedRecords.reduce((total, record) => {
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
    const advanceAmount = money(paidAdvanceMap.get(employee.id) ?? 0);
    const manualDeduction = money(Number(adjustment?.manualDeduction ?? 0));
    const firstPaidAmount = money(Number(adjustment?.paidAmount ?? 0));
    const secondPaidAmount = money(Number(adjustment?.secondPaidAmount ?? 0));
    const paidAmount = money(firstPaidAmount + secondPaidAmount);
    const deductions = money(socialInsurance + incomeTax + advanceAmount + manualDeduction);
    const carryoverAmount = money(previousLineMap.get(employee.id)?.balanceAmount ?? 0);
    const payableBeforePayment = money(gross - deductions + carryoverAmount);
    const payable = money(Math.max(0, payableBeforePayment));
    const rawBalanceAmount = payableBeforePayment - paidAmount;
    const balanceAmount = money(Math.abs(rawBalanceAmount) <= 1 ? 0 : rawBalanceAmount);
    const remainingAmount = money(Math.max(0, balanceAmount));
    const overpaidAmount = money(Math.max(0, -balanceAmount));
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
      advanceAmount,
      manualDeduction,
      receivableId: adjustment?.receivableId ?? null,
      deductions,
      carryoverAmount,
      payable,
      paidAmount,
      paymentDate: adjustment?.paymentDate ?? null,
      secondPaidAmount,
      secondPaymentDate: adjustment?.secondPaymentDate ?? null,
      remainingAmount,
      overpaidAmount,
      balanceAmount,
      net: payable,
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
    totalGross: money(lines.reduce((total, line) => total + line.gross, 0)),
    totalSocialInsurance: money(lines.reduce((total, line) => total + line.socialInsurance, 0)),
    totalIncomeTax: money(lines.reduce((total, line) => total + line.incomeTax, 0)),
    totalDeductions: money(lines.reduce((total, line) => total + line.deductions, 0)),
    totalNet: money(lines.reduce((total, line) => total + line.net, 0)),
    lines,
  };
}

export async function getPayrollAdvanceSummary(month: string) {
  const rawSchedule = await getPayrollSchedule(month);
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
  const [approval] = await db
    .select()
    .from(payrollAdvanceApprovalsTable)
    .where(eq(payrollAdvanceApprovalsTable.month, month));
  if (approval) {
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
    db.select().from(employeesTable),
    db.select().from(attendanceTable).where(and(
      gte(attendanceTable.date, period.periodStart),
      lte(attendanceTable.date, period.advancePeriodEnd),
    )),
    db.select().from(employeeSalaryHistoryTable),
  ]);
  const employees = allEmployees.filter((employee) =>
    employee.joinedAt <= period.advancePeriodEnd
    && (!employee.inactiveAt || employee.inactiveAt >= period.periodStart)
    && salaryAt(employee, salaryHistory, period.advancePeriodEnd).payFrequency === "twice",
  );
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