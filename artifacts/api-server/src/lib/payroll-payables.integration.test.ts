import assert from "node:assert/strict";
import { test, after } from "node:test";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { readPayrollPayables } from "./payroll-payables.js";
import { PayrollBalancesNotReadyError } from "./payroll-balance-store.js";
import { GetPayrollResponse } from "@workspace/api-zod";

const summary = (month: string, balanceAmount = 300) => ({
  month, periodStart: `${month}-01`, advancePeriodEnd: `${month}-15`, periodEnd: `${month}-28`,
  advancePaymentDate: `${month}-20`, finalPaymentDate: `${month}-28`,
  schedule: { id: 1, effectiveFromMonth: "2024-01", periodStartDay: 1, advanceCutoffDay: 15, periodEndDay: 31, advancePayDay: 20, finalPayDay: 31 },
  totalGross: 100, totalSocialInsurance: 0, totalIncomeTax: 0, totalDeductions: 0, totalNet: 300,
  lines: [{ employeeId: 1, employeeName: "Saved employee", employeeType: "shift", role: "Test", bankAccountNumber: "",
    daysWorked: 1, hours: 8, gross: 100, socialInsuranceSalary: 0, socialInsurance: 0,
    taxableIncome: 0, calculatedIncomeTax: 0, taxRelief: 0, incomeTax: 0, advanceAmount: 0, manualDeduction: 0, receivableId: null,
    deductions: 0, carryoverAmount: 200, payable: 300, net: 300, paidAmount: 0, paymentDate: null,
    secondPaidAmount: 0, secondPaymentDate: null, remainingAmount: balanceAmount, overpaidAmount: 0, balanceAmount }],
});
after(async () => { await pool.end(); });

test("saved payroll debt follows real payment/rollback sources and frozen closures without public DDL", async () => {
  await db.transaction(async tx => {
    // Session-local shadows: no public financial rows or table definitions are changed.
    for (const table of [
      "payroll_attendance_snapshots", "payroll_month_closures", "payroll_month_balances",
      "payroll_adjustments", "payroll_advance_approvals",
    ]) await tx.execute(sql.raw(`CREATE TEMP TABLE "${table}" (LIKE public."${table}" INCLUDING DEFAULTS) ON COMMIT DROP`));
    await tx.execute(sql`CREATE TEMP TABLE employees (id integer, name text) ON COMMIT DROP`);
    // Any accidental historical attendance query now fails rather than reading real data.
    await tx.execute(sql`CREATE TEMP TABLE attendance (id integer) ON COMMIT DROP`);
    await tx.execute(sql`INSERT INTO employees VALUES (1, 'Current name')`);
    await tx.execute(sql`INSERT INTO payroll_month_balances (month,period_start,period_end,lines,dirty) VALUES
      ('2026-08','2026-08-01','2026-08-28','[{"employeeId":1,"movement":200,"balanceAmount":200},{"employeeId":3,"movement":40,"balanceAmount":40}]',false),
      ('2026-09','2026-09-01','2026-09-28','[{"employeeId":1,"movement":100,"balanceAmount":300}]',false)`);
    const payload = GetPayrollResponse.parse(summary("2026-09"));
    await tx.execute(sql`INSERT INTO payroll_attendance_snapshots (month,payroll,advance) VALUES ('2026-09',${JSON.stringify(payload)}::jsonb,'{}')`);
    const read = () => readPayrollPayables(tx, "2026-09");
    assert.equal((await read()).totalOutstanding, 340);
    assert.equal((await read()).lines.find(line => line.employeeId === 1)?.employeeName, "Current name");
    await tx.execute(sql`INSERT INTO payroll_adjustments (id,employee_id,month,paid_amount,second_paid_amount)
      VALUES (1,1,'2026-09',50,25)`);
    assert.equal((await read()).lines.find(line => line.employeeId === 1)?.remainingBalance, 225);
    await tx.execute(sql`UPDATE payroll_adjustments SET paid_amount=500 WHERE id=1`);
    assert.equal((await read()).lines.some(line => line.employeeId === 1), false);
    await tx.execute(sql`DELETE FROM payroll_adjustments WHERE id=1`);
    assert.equal((await read()).totalOutstanding, 340);
    const advanceLine = [{ employeeId: 1, employeeName: "Saved employee", employeeType: "shift",
      baseSalary: 100, daysWorked: 1, dailySalary: 100, totalSalary: 100, advanceAmount: 40, paid: false }];
    await tx.execute(sql`INSERT INTO payroll_advance_approvals (id,month,lines,total_amount,approval_date)
      VALUES (1,'2026-09',${JSON.stringify(advanceLine)}::jsonb,40,'2026-09-15')`);
    assert.equal((await read()).totalOutstanding, 340, "unpaid approved advance is not deducted");
    advanceLine[0].paid = true;
    await tx.execute(sql`UPDATE payroll_advance_approvals SET lines=${JSON.stringify(advanceLine)}::jsonb WHERE id=1`);
    assert.equal((await read()).totalOutstanding, 300, "paid advance reduces salary debt");
    await tx.execute(sql`DELETE FROM payroll_advance_approvals WHERE id=1`);
    assert.equal((await read()).totalOutstanding, 340, "cancelled advance restores salary debt");
    await tx.execute(sql`UPDATE payroll_month_balances SET dirty=true WHERE month='2026-09'`);
    assert.equal((await read()).lines.find(line => line.employeeId === 1)?.attendanceNeedsRefresh, true);
    await tx.execute(sql`UPDATE payroll_month_balances SET dirty=true WHERE month='2026-08'`);
    await assert.rejects(read(), PayrollBalancesNotReadyError);
    await tx.execute(sql`UPDATE payroll_month_balances SET dirty=false`);
    const frozen = GetPayrollResponse.parse(summary("2026-09", 123));
    await tx.execute(sql`INSERT INTO payroll_month_closures (month,payroll,advance,closed_by)
      VALUES ('2026-09',${JSON.stringify(frozen)}::jsonb,'{}',1)`);
    await tx.execute(sql`INSERT INTO payroll_adjustments (id,employee_id,month,paid_amount) VALUES (2,1,'2026-09',900)`);
    const closed = await read();
    assert.equal(closed.lines.find(line => line.employeeId === 1)?.remainingBalance, 123);
    assert.equal(closed.lines.find(line => line.employeeId === 1)?.closed, true);
    const savedBefore = await tx.execute(sql`SELECT payroll FROM payroll_attendance_snapshots`);
    await read(); await read();
    assert.deepEqual((await tx.execute(sql`SELECT payroll FROM payroll_attendance_snapshots`)).rows, savedBefore.rows);
  });
});
