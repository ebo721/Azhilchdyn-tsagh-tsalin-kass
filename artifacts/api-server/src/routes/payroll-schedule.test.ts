import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  payrollPeriod,
  scheduleVersionAffectsMonth,
  selectPayrollScheduleVersion,
  shiftDailyRate,
} from "./operations.js";

const defaults = {
  periodStartDay: 1,
  advanceCutoffDay: 15,
  periodEndDay: 31,
  advancePayDay: 15,
  finalPayDay: 31,
};

describe("payroll schedule date rules", () => {
  it("clamps day 31 to February and keeps the default same-month cycle", () => {
    assert.deepEqual(payrollPeriod("2099-02", defaults), {
      periodStart: "2099-02-01",
      advancePeriodEnd: "2099-02-15",
      periodEnd: "2099-02-28",
      advancePaymentDate: "2099-02-15",
      finalPaymentDate: "2099-02-28",
    });
  });

  it("constructs a cross-month 26–25 cycle and places cutoff in the ending month", () => {
    assert.deepEqual(payrollPeriod("2099-02", {
      ...defaults,
      periodStartDay: 26,
      advanceCutoffDay: 10,
      periodEndDay: 25,
      advancePayDay: 15,
      finalPayDay: 31,
    }), {
      periodStart: "2099-01-26",
      advancePeriodEnd: "2099-02-10",
      periodEnd: "2099-02-25",
      advancePaymentDate: "2099-02-15",
      finalPaymentDate: "2099-02-28",
    });
  });

  it("selects the latest effective version without changing prior months", () => {
    const versions = [
      { effectiveFromMonth: "0001-01", periodStartDay: 1 },
      { effectiveFromMonth: "2099-02", periodStartDay: 26 },
    ];
    assert.equal(selectPayrollScheduleVersion(versions, "2099-01")?.periodStartDay, 1);
    assert.equal(selectPayrollScheduleVersion(versions, "2099-02")?.periodStartDay, 26);
    assert.equal(selectPayrollScheduleVersion(versions, "2099-03")?.periodStartDay, 26);
  });

  it("protects every frozen month until the next schedule version", () => {
    assert.equal(scheduleVersionAffectsMonth("2099-01", "2099-02", "2099-05"), false);
    assert.equal(scheduleVersionAffectsMonth("2099-02", "2099-02", "2099-05"), true);
    assert.equal(scheduleVersionAffectsMonth("2099-04", "2099-02", "2099-05"), true);
    assert.equal(scheduleVersionAffectsMonth("2099-05", "2099-02", "2099-05"), false);
    assert.equal(scheduleVersionAffectsMonth("2100-01", "2099-02"), true);
  });

  it("derives a shift monthly daily rate from the effective divisor", () => {
    assert.equal(shiftDailyRate({ salaryType: "monthly", baseSalary: 3_100_000, monthlyExpectedWorkDays: 31 }), 100_000);
    assert.equal(shiftDailyRate({ salaryType: "daily", baseSalary: 125_000, monthlyExpectedWorkDays: 0 }), 125_000);
  });

  it("exposes calendar dates rather than ISO timestamps", () => {
    const result = payrollPeriod("2099-02", defaults);
    for (const value of Object.values(result)) assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
  });
});