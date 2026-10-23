import assert from "node:assert/strict";
import { it } from "node:test";
import { advancePaidAmount, advancePayments, advanceFinancials } from "./payroll-advance-installments.js";

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
