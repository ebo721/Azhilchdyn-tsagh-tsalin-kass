import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeDashboardPayroll } from "./dashboard-payroll.js";

const shifts = [{ id: 1, name: "1-р ээлж" }, { id: 2, name: "2-р ээлж" }, { id: 3, name: "3-р ээлж" }];
describe("dashboard saved gross breakdown", () => {
  it("uses saved gross, separates office and sums each shift without double counting", () => {
    const result = summarizeDashboardPayroll([
      { employeeId: 1, employeeType: "office", gross: 1500.25, daysWorked: 1 },
      { employeeId: 2, employeeType: "shift", gross: 300.01, daysWorked: 3 },
    ], [
      { employeeId: 2, date: "2026-09-01", shiftId: 1 },
      { employeeId: 2, date: "2026-09-02", shiftId: 2 },
      { employeeId: 2, date: "2026-09-03", shiftId: 2 },
    ], [
      { employeeId: 2, date: "2026-09-01", status: "present" },
      { employeeId: 2, date: "2026-09-02", status: "late" },
      { employeeId: 2, date: "2026-09-03", status: "present" },
      { employeeId: 2, date: "2026-09-04", status: "leave" },
    ], shifts);
    assert.equal(result.payrollGross, 1800.26);
    assert.equal(result.officePayrollGross, 1500.25);
    assert.deepEqual(result.payrollByShift.map(row => row.gross), [100, 200.01, 0]);
    assert.equal(Math.round((result.officePayrollGross + result.payrollByShift.reduce((n, r) => n + r.gross, 0)) * 100),
      Math.round(result.payrollGross * 100));
  });
  it("assigns unmatched days to an explicit unknown group", () => {
    const result = summarizeDashboardPayroll([{ employeeId: 2, employeeType: "shift", gross: 100, daysWorked: 2 }],
      [{ employeeId: 2, date: "2026-09-01", shiftId: 1 }],
      [{ employeeId: 2, date: "2026-09-01", status: "present" }, { employeeId: 2, date: "2026-09-02", status: "present" }], shifts);
    assert.deepEqual(result.payrollByShift.filter(row => row.gross !== 0).map(row => [row.shiftId, row.gross]), [[1, 50], [null, 50]]);
  });
  it("does not silently redistribute stale saved earnings using changed attendance", () => {
    const result = summarizeDashboardPayroll([{ employeeId: 2, employeeType: "shift", gross: 100, daysWorked: 2 }],
      [{ employeeId: 2, date: "2026-09-01", shiftId: 1 }],
      [{ employeeId: 2, date: "2026-09-01", status: "present" }], shifts);
    assert.equal(result.payrollByShift.find(row => row.shiftId === null)?.gross, 100);
    assert.equal(result.payrollByShift.find(row => row.shiftId === 1)?.gross, 0);
  });
  it("handles full-salary employees with no attendance without inventing worked days", () => {
    const result = summarizeDashboardPayroll([{ employeeId: 2, employeeType: "shift", gross: 100, daysWorked: 0 }], [], [], shifts);
    assert.equal(result.payrollByShift.find(row => row.shiftId === null)?.gross, 100);
  });
  it("uses an unknown group if a planned shift no longer exists", () => {
    const result = summarizeDashboardPayroll([{ employeeId: 2, employeeType: "shift", gross: 100, daysWorked: 1 }],
      [{ employeeId: 2, date: "2026-09-01", shiftId: 99 }], [{ employeeId: 2, date: "2026-09-01", status: "present" }], shifts);
    assert.equal(result.payrollByShift.find(row => row.shiftId === null)?.gross, 100);
  });
  it("handles an empty saved month as a real zero, including zero-valued shifts", () => {
    const result = summarizeDashboardPayroll([], [], [], shifts);
    assert.equal(result.payrollGross, 0);
    assert.equal(result.officePayrollGross, 0);
    assert.equal(result.payrollByShift.length, 3);
  });
  it("preserves fractional cents allocation deterministically", () => {
    const days = ["2026-09-01", "2026-09-02", "2026-09-03"];
    const result = summarizeDashboardPayroll([{ employeeId: 2, employeeType: "shift", gross: 0.02, daysWorked: 3 }],
      days.map((date, index) => ({ employeeId: 2, date, shiftId: index + 1 })),
      days.map(date => ({ employeeId: 2, date, status: "present" })), shifts);
    assert.deepEqual(result.payrollByShift.map(row => row.gross), [0.01, 0.01, 0]);
  });
});
