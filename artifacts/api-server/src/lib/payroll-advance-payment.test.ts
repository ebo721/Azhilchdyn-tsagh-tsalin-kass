import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planPayrollAdvancePayment } from "./payroll-advance-payment.ts";

const sourceLines = [
  { employeeId: 11, employeeName: "A", advanceAmount: 100_000, paid: false },
  { employeeId: 12, employeeName: "B", advanceAmount: 80_000, paid: true, paymentDate: "2026-09-10" },
];

describe("planPayrollAdvancePayment", () => {
  it("keeps the approved line, approval total, and cash expense on the edited amount", () => {
    const plan = planPayrollAdvancePayment(sourceLines, {
      month: "2026-09",
      employeeId: 11,
      advanceAmount: 125_500.25,
      paid: true,
      paymentDate: "2026-09-12",
    });

    assert.equal(plan.selectedLine?.advanceAmount, 125_500.25);
    assert.equal(plan.totalAmount, 205_500.25);
    assert.equal(plan.cashTransaction?.amount, plan.selectedLine?.advanceAmount);
  });

  it("uses the same cash source key when the same line is edited again", () => {
    const first = planPayrollAdvancePayment(sourceLines, {
      month: "2026-09",
      employeeId: 11,
      advanceAmount: 125_000,
      paid: true,
      paymentDate: "2026-09-12",
    });
    const second = planPayrollAdvancePayment(first.lines, {
      month: "2026-09",
      employeeId: 11,
      advanceAmount: 130_000,
      paid: true,
      paymentDate: "2026-09-13",
    });

    assert.equal(first.cashTransaction?.sourceKey, "2026-09:11");
    assert.equal(second.cashTransaction?.sourceKey, first.cashTransaction?.sourceKey);
    assert.equal(second.cashTransaction?.amount, 130_000);
  });

  it("removes the cash action and paid deduction when payment is reverted", () => {
    const paid = planPayrollAdvancePayment(sourceLines, {
      month: "2026-09",
      employeeId: 11,
      advanceAmount: 125_000,
      paid: true,
      paymentDate: "2026-09-12",
    });
    const reverted = planPayrollAdvancePayment(paid.lines, {
      month: "2026-09",
      employeeId: 11,
      advanceAmount: 125_000,
      paid: false,
      paymentDate: null,
    });

    assert.equal(reverted.selectedLine?.paid, false);
    assert.equal(reverted.selectedLine?.paymentDate, null);
    assert.equal(reverted.cashTransaction, null);
  });
});