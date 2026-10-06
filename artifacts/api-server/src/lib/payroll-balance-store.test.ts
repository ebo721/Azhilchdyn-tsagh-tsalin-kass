import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, it } from "node:test";
import { pool } from "@workspace/db";
import { closingBalances, PayrollBalancesNotReadyError, rebuildPayrollBalances } from "./payroll-balance-store.js";
import { getPayrollAdvanceSummary, getPayrollSummary } from "./payroll-calc-helpers.js";

after(() => pool.end());

it("carries signed financial movements and applies the monthly ±1₮ tolerance", () => {
  assert.deepEqual(closingBalances([{ employeeId: 1, movement: 100 }], [{ employeeId: 1, balanceAmount: -400 }]),
    [{ employeeId: 1, movement: 100, balanceAmount: -300 }]);
  assert.equal(closingBalances([{ employeeId: 1, movement: 1 }], [])[0].balanceAmount, 0);
  assert.equal(closingBalances([{ employeeId: 1, movement: -1 }], [])[0].balanceAmount, 0);
  assert.equal(closingBalances([{ employeeId: 1, movement: 1.01 }], [])[0].balanceAmount, 1.01);
});

it("real SQL: monthly attendance only, explicit financial initialization, source invalidation and resumable repair", async t => {
  if (process.env.PRODUCTION_DATABASE_URL && process.env.DATABASE_URL === process.env.PRODUCTION_DATABASE_URL) {
    throw new Error("Refusing schema-writing tests against production");
  }
  const schema = `payroll_test_${Date.now()}`;
  const client = await pool.connect();
  const query = client.query.bind(client);
  await query(`CREATE SCHEMA ${schema}`);
  try {
    for (const table of ["employees", "employee_salary_history", "attendance", "payroll_adjustments",
      "payroll_advance_approvals", "payroll_schedule_settings"]) {
      await query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    const migration = readFileSync(new URL("../../../../lib/db/migrations/20261008_payroll_month_balances.sql", import.meta.url), "utf8");
    await query(migration.replaceAll("public.", `${schema}.`));
    await query(`SET search_path TO ${schema}`);
    const attendanceQueries: Array<{ text: string; values: unknown[] }> = [];
    const auditedQuery = ((config: { text: string } | string, values?: unknown[]) => {
      const text = typeof config === "string" ? config : config.text;
      if (/from "attendance"/i.test(text)) attendanceQueries.push({ text, values: values ?? [] });
      return query(config as never, values as never);
    }) as typeof client.query;
    t.mock.method(pool, "connect", (() => Promise.resolve({ query: auditedQuery, release() {} } as unknown as typeof client)) as typeof pool.connect);
    t.mock.method(pool, "query", auditedQuery as typeof pool.query);
    await query(`INSERT INTO payroll_schedule_settings (effective_from_month) VALUES ('0001-01')`);
    await query(`INSERT INTO employees (id,name,role,employee_type,salary_type,base_salary,payroll_tax_exempt,joined_at)
      VALUES (1,'Financial test','Test','shift','daily',100,true,'2024-01-01')`);
    await query(`INSERT INTO attendance (employee_id,date,clock_in,clock_out,hours,status)
      VALUES (1,'2024-01-05','08:00','16:00',8,'present'),
             (1,'2024-02-05','08:00','16:00',8,'present'),
             (1,'2024-03-05','08:00','16:00',8,'present'),
             (1,'2099-01-05','08:00','16:00',8,'present')`);
    await query(`INSERT INTO payroll_adjustments (employee_id,month,paid_amount)
      VALUES (1,'2024-01',500)`);

    await t.test("first employment month starts with zero without reading older attendance", async () => {
      attendanceQueries.length = 0;
      const january = await getPayrollSummary("2024-01");
      assert.equal(january.lines[0].balanceAmount, -400);
      assert.equal(january.lines[0].paidAmount, 500);
      assert.equal(attendanceQueries.length, 1);
      assert.deepEqual(attendanceQueries[0].values, ["2024-01-01", "2024-01-31"]);
    });
    await t.test("a missing prior balance is rejected, never guessed or reconstructed by the GET", async () => {
      attendanceQueries.length = 0;
      await assert.rejects(getPayrollSummary("2024-03"), PayrollBalancesNotReadyError);
      assert.equal(attendanceQueries.length, 1);
      assert.deepEqual(attendanceQueries[0].values, ["2024-03-01", "2024-03-31"]);
    });
    await t.test("initialization reads only missing months and preserves recorded payments", async () => {
      attendanceQueries.length = 0;
      const result = await rebuildPayrollBalances("2024-02");
      assert.deepEqual(result, { complete: true, processedMonths: ["2024-02"], nextMonth: null });
      assert.equal(attendanceQueries.length, 1);
      assert.deepEqual(attendanceQueries[0].values, ["2024-02-01", "2024-02-29"]);
      const march = await getPayrollSummary("2024-03");
      assert.equal(march.lines[0].carryoverAmount, -300);
      assert.equal(march.lines[0].balanceAmount, -200);
    });
    await t.test("old attendance edits invalidate the affected period and rebase later finances without their attendance", async () => {
      await query(`UPDATE attendance SET status='absent' WHERE date='2024-01-05'`);
      await assert.rejects(getPayrollSummary("2024-03"), PayrollBalancesNotReadyError);
      attendanceQueries.length = 0;
      const result = await rebuildPayrollBalances("2024-02");
      assert.deepEqual(result.processedMonths, ["2024-01"]);
      assert.equal(attendanceQueries.length, 1);
      assert.deepEqual(attendanceQueries[0].values, ["2024-01-01", "2024-01-31"]);
      const march = await getPayrollSummary("2024-03");
      assert.equal(march.lines[0].carryoverAmount, -400);
      assert.equal(march.lines[0].balanceAmount, -300);
      const payment = await query(`SELECT paid_amount FROM payroll_adjustments WHERE month='2024-01'`);
      assert.equal(Number(payment.rows[0].paid_amount), 500);
    });
    await t.test("paid amounts, advance approvals, salary history and deletion all invalidate stored balances", async () => {
      for (const mutation of [
        `UPDATE payroll_adjustments SET paid_amount=600 WHERE month='2024-01'`,
        `INSERT INTO payroll_advance_approvals (month,lines,total_amount,approval_date) VALUES ('2024-01','[]',0,'2024-01-15')`,
        `DELETE FROM payroll_advance_approvals WHERE month='2024-01'`,
        `INSERT INTO employee_salary_history (employee_id,effective_from,employee_type,base_salary,payroll_tax_exempt) VALUES (1,'2024-01-01','shift',100,true)`,
        `DELETE FROM employee_salary_history WHERE employee_id=1`,
        `DELETE FROM attendance WHERE date='2024-01-05'`,
      ]) {
        await query(mutation);
        await assert.rejects(getPayrollSummary("2024-03"), PayrollBalancesNotReadyError);
        await rebuildPayrollBalances("2024-02");
        await getPayrollSummary("2024-03");
      }
    });
    await t.test("contact edits leave financial records valid", async () => {
      await query(`UPDATE employees SET phone='fixture' WHERE id=1`);
      const summary = await getPayrollSummary("2024-03");
      assert.equal(summary.lines[0].carryoverAmount, -500);
    });
    await t.test("employment-date corrections do not leave unrepairable pre-baseline dirty records", async () => {
      await query(`UPDATE employees SET joined_at='2024-02-01' WHERE id=1`);
      await rebuildPayrollBalances("2024-02");
      assert.equal((await getPayrollSummary("2024-03")).lines[0].carryoverAmount, 100);
      await query(`UPDATE employees SET joined_at='2024-01-01' WHERE id=1`);
      await rebuildPayrollBalances("2024-02");
      assert.equal((await getPayrollSummary("2024-03")).lines[0].carryoverAmount, -500);
    });
    await t.test("cross-month payroll and advances are bounded to the effective configured period", async () => {
      await query(`INSERT INTO payroll_schedule_settings (effective_from_month,period_start_day,period_end_day,advance_cutoff_day)
        VALUES ('2024-03',21,20,5)`);
      await assert.rejects(getPayrollSummary("2024-04"), PayrollBalancesNotReadyError);
      await rebuildPayrollBalances("2024-03");
      attendanceQueries.length = 0;
      await getPayrollSummary("2024-04");
      assert.deepEqual(attendanceQueries[0].values, ["2024-03-21", "2024-04-20"]);
      attendanceQueries.length = 0;
      await getPayrollAdvanceSummary("2024-04");
      assert.deepEqual(attendanceQueries[0].values, ["2024-03-21", "2024-04-05"]);
      await query(`UPDATE attendance SET status='late' WHERE date='2024-03-05'`);
      const dirty = await query(`SELECT month FROM payroll_month_balances WHERE dirty ORDER BY month`);
      assert.deepEqual(dirty.rows.map(row => row.month), ["2024-03"]);
    });
    await t.test("repair batches resume and clean history never causes attendance reads", async () => {
      let result = await rebuildPayrollBalances("2025-02");
      assert.equal(result.complete, false);
      assert.equal(result.processedMonths.length, 6);
      while (!result.complete) result = await rebuildPayrollBalances("2025-02");
      attendanceQueries.length = 0;
      const clean = await rebuildPayrollBalances("2025-02");
      assert.deepEqual(clean.processedMonths, []);
      assert.equal(attendanceQueries.length, 0);
      attendanceQueries.length = 0;
      await getPayrollSummary("2025-03");
      assert.equal(attendanceQueries.length, 1);
      assert.deepEqual(attendanceQueries[0].values, ["2025-02-21", "2025-03-20"]);
    });
  } finally {
    t.mock.restoreAll();
    await query("RESET search_path");
    await query(`DROP SCHEMA ${schema} CASCADE`);
    client.release();
  }
});
