import { desc, eq, lte } from "drizzle-orm";
import { db, payrollScheduleSettingsTable } from "@workspace/db";
import { currentMonth, nextMonth, previousMonth } from "./date-utils.js";
import { defaultPayrollSchedule, scheduleDate, type SalaryHistoryRow } from "./route-shared.js";

export const monthlyIncomeTaxRelief = (socialInsuranceSalary: number) => {
  if (socialInsuranceSalary <= 500_000) return 20_000;
  if (socialInsuranceSalary <= 1_000_000) return 18_000;
  if (socialInsuranceSalary <= 1_500_000) return 16_000;
  if (socialInsuranceSalary <= 2_000_000) return 14_000;
  if (socialInsuranceSalary <= 2_500_000) return 12_000;
  if (socialInsuranceSalary <= 3_000_000) return 10_000;
  return 0;
};

export async function getPayrollSchedule(month = currentMonth()) {
  let [row] = await db.select().from(payrollScheduleSettingsTable)
    .where(lte(payrollScheduleSettingsTable.effectiveFromMonth, month))
    .orderBy(desc(payrollScheduleSettingsTable.effectiveFromMonth))
    .limit(1);
  if (!row) {
    [row] = await db.insert(payrollScheduleSettingsTable)
      .values({ ...defaultPayrollSchedule, effectiveFromMonth: "0001-01" })
      .onConflictDoNothing({ target: payrollScheduleSettingsTable.effectiveFromMonth })
      .returning();
    if (!row) {
      [row] = await db.select().from(payrollScheduleSettingsTable)
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