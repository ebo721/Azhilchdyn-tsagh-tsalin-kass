import assert from "node:assert/strict";
import { it } from "node:test";
import { advancePaidAmount, advancePayments, advanceFinancials, advanceSettledAmount } from "./payroll-advance-installments.js";

it("keeps legacy paid advances and their first payment identity", () => {
  const line = { advanceAmount: 1000, paid: true, paymentDate: "2026-10-15" };
  assert.deepEqual(advancePayments(line), [{ sequence: 1, amount: 1000, date: "2026-10-15" }]);
  assert.equal(advancePaidAmount(line), 1000);
  assert.equal(advancePaidAmount({ advanceAmount: 1000, paid: true }), 1000);
  assert.equal(advancePaidAmount({ advanceAmount: 1000, paid: false }), 0);
});

it("partial installments, not the legacy paid boolean or approved total, drive deductions", () => {
  const line = { advanceAmount: 1000, paid: false, payments: [
    { sequence: 1, amount: 100.25, date: "2026-10-15" },
    { sequence: 4, amount: 200.50, date: "2026-10-16" },
    { sequence: 7, amount: 300.25, date: "2026-10-17" },
  ] };
  assert.equal(advancePaidAmount(line), 601);
  assert.equal(advanceFinancials(line).remainingBalance, 399);
  assert.equal(advancePaidAmount({ ...line, paid: true }), 601);
  assert.equal(advancePaidAmount({ ...line, payments: [], paid: true }), 0);
});

it("settles receivables without inventing cash and deducts cash plus settlement once", () => {
  const line = { advanceAmount: 500000, receivableDeduction: 100000, paid: false };
  assert.equal(advancePaidAmount(line), 0);
  assert.equal(advanceSettledAmount(line), 100000);
  assert.equal(advanceFinancials(line).remainingBalance, 400000);
  const paid = { ...line, paid: true, paymentDate: "2026-11-15" };
  assert.equal(advancePaidAmount(paid), 400000);
  assert.equal(advanceSettledAmount(paid), 500000);
  assert.deepEqual(advancePayments(paid), [{ sequence: 1, amount: 400000, date: "2026-11-15" }]);
  const partial = { ...line, payments: [{ sequence: 1, amount: 150000, date: "2026-11-15" }] };
  assert.equal(advanceSettledAmount(partial), 250000);
  assert.equal(advanceFinancials(partial).remainingBalance, 250000);
  const full = { advanceAmount: 500000, receivableDeduction: 500000, paid: true, paymentDate: "2026-11-15" };
  assert.equal(advancePaidAmount(full), 0);
  assert.equal(advanceSettledAmount(full), 500000);
  assert.deepEqual(advancePayments(full), []);
});
