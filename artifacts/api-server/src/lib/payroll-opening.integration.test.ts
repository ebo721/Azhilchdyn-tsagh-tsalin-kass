import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { after, it } from "node:test";
import { pool, db, usersTable } from "@workspace/db";
import { GetPayrollAdvanceResponse } from "@workspace/api-zod";
import app from "../app.js";
import { createStaffSession, hrCookie, type StaffRole } from "./hr-session.js";
import { payrollOpeningDraft, confirmPayrollOpening, PayrollOpeningConflict } from "./payroll-opening.js";
import { refreshEmployeePayroll } from "./payroll-employee-refresh.js";
import { readSavedPayroll } from "./payroll-attendance-snapshot.js";
import { getPayrollAdvanceSummary } from "./payroll-calc-helpers.js";
import { readPayrollRegister } from "./payroll-register.js";

after(() => pool.end());

it("real SQL: reviewed opening debt and employee-scoped refresh preserve other people and payments", async t => {
  if (process.env.PRODUCTION_DATABASE_URL && process.env.DATABASE_URL === process.env.PRODUCTION_DATABASE_URL) {
    throw new Error("Refusing schema-writing tests against production");
  }
  const schema = `payroll_opening_test_${Date.now()}`;
  const client = await pool.connect();
  const query = client.query.bind(client);
  await query(`CREATE SCHEMA ${schema}`);
  try {
    for (const table of ["users", "employees", "employee_salary_history", "attendance", "payroll_adjustments",
      "payroll_advance_approvals", "payroll_schedule_settings"]) {
      await query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    for (const migration of ["20261008_payroll_month_balances.sql", "20261010_payroll_attendance_snapshots.sql",
      "20261019_payroll_month_closures.sql", "20261022_payroll_opening_selective.sql"]) {
      await query(readFileSync(new URL(`../../../../lib/db/migrations/${migration}`, import.meta.url), "utf8")
        .replaceAll("public.", `${schema}.`));
    }
    await query(`SET search_path TO ${schema}`);
    const statements: string[] = [];
    const auditedQuery = ((config: { text: string } | string, values?: unknown[]) => {
      statements.push(typeof config === "string" ? config : config.text);
      return query(config as never, values as never);
    }) as typeof client.query;
    t.mock.method(pool, "connect", (() => Promise.resolve({ query: auditedQuery, release() {} } as unknown as typeof client)) as typeof pool.connect);
    t.mock.method(pool, "query", auditedQuery as typeof pool.query);
    await query(`INSERT INTO payroll_schedule_settings (effective_from_month) VALUES ('0001-01')`);
    await query(`INSERT INTO employees (id,name,role,employee_type,salary_type,base_salary,payroll_tax_exempt,joined_at,pay_frequency)
      VALUES (1,'Opening one','Test','shift','daily',100,true,'2024-07-01','twice'),
             (2,'Opening two','Test','shift','daily',200,true,'2024-09-01','twice')`);
    await query(`INSERT INTO employee_salary_history (employee_id,effective_from,employee_type,salary_type,base_salary,payroll_tax_exempt,pay_frequency)
      VALUES (1,'2024-09-01','shift','daily',100,true,'twice'),
             (2,'2024-09-01','shift','daily',200,true,'twice')`);
    await query(`INSERT INTO attendance (employee_id,date,clock_in,clock_out,hours,status)
      VALUES (1,'2024-09-05','08:00','16:00',8,'present'),(2,'2024-09-06','08:00','16:00',8,'present')`);

    await t.test("explicitly reviews every employee without reading 24 months of attendance", async () => {
      statements.length = 0;
      const draft = await payrollOpeningDraft("2024-08");
      assert.deepEqual(draft.lines.map(l => [l.employeeId, l.balanceAmount]), [[1, null]]);
      assert.ok(!statements.some(s => /from "attendance"/i.test(s)));
      await assert.rejects(confirmPayrollOpening({
        month: "2024-08", revision: draft.revision, sourceRevision: draft.sourceRevision,
        note: "Тулган баталсан", verified: true, lines: [],
      }, 7), PayrollOpeningConflict);
      const confirmed = await confirmPayrollOpening({
        month: "2024-08", revision: draft.revision, sourceRevision: draft.sourceRevision,
        note: "Тулган баталсан", verified: true, lines: [{ employeeId: 1, balanceAmount: 1_000 }],
      }, 7);
      assert.equal(confirmed.confirmedMonth, "2024-08");
      assert.equal(confirmed.lines[0].balanceAmount, 1_000);
      await assert.rejects(confirmPayrollOpening({
        month: "2024-08", revision: draft.revision, sourceRevision: draft.sourceRevision,
        note: "Тулган баталсан", verified: true, lines: [{ employeeId: 1, balanceAmount: 0 }],
      }, 7), PayrollOpeningConflict);
      const otherMonth = await payrollOpeningDraft("2024-07");
      await assert.rejects(confirmPayrollOpening({
        month: "2024-07", revision: otherMonth.revision, sourceRevision: otherMonth.sourceRevision,
        note: "Сарыг солиогүй", verified: true, lines: [{ employeeId: 1, balanceAmount: 0 }],
      }, 7), PayrollOpeningConflict);
      assert.ok(!statements.some(s => /from "attendance"/i.test(s)));
    });

    await t.test("GET never computes earnings; independent refresh leaves other rows untouched", async () => {
      statements.length = 0;
      const before = await readSavedPayroll("2024-09");
      assert.deepEqual(before.lines.map(l => l.calculationReady), [false, false]);
      assert.equal(before.lines[0].carryoverAmount, 1_000);
      assert.deepEqual(GetPayrollAdvanceResponse.parse(
        await getPayrollAdvanceSummary("2024-09", db, { savedOnly: true })).lines, []);
      assert.ok(!statements.some(s => /from "attendance"/i.test(s)));
      const first = await refreshEmployeePayroll("2024-09", 1);
      assert.equal(first.payroll.lines[0].gross, 100);
      assert.equal(first.payroll.lines[0].balanceAmount, 1_100);
      assert.equal(first.payroll.lines[1].calculationReady, false);
      const second = await refreshEmployeePayroll("2024-09", 2);
      assert.equal(second.payroll.lines[0].gross, 100);
      assert.equal(second.payroll.lines[1].gross, 200);
      assert.equal(second.payroll.lines[1].carryoverAmount, 0);
      assert.equal(second.payroll.attendanceNeedsRefresh, false);
    });

    await t.test("one changed employee is flagged; payments update financially without re-reading attendance", async () => {
      await query(`INSERT INTO attendance (employee_id,date,clock_in,clock_out,hours,status)
        VALUES (1,'2024-09-09','08:00','16:00',8,'present')`);
      statements.length = 0;
      let status = await readSavedPayroll("2024-09");
      assert.equal(status.lines[0].attendanceNeedsRefresh, true);
      assert.equal(status.lines[1].attendanceNeedsRefresh, false);
      assert.ok(!statements.some(s => /from "attendance"/i.test(s)));
      const refreshed = await refreshEmployeePayroll("2024-09", 1);
      status = refreshed.payroll;
      assert.deepEqual(refreshed.advance.lines.map(l => l.employeeId).sort(), [1, 2]);
      assert.equal(status.lines[0].gross, 200);
      assert.equal(status.lines[1].gross, 200);
      await query(`INSERT INTO payroll_adjustments (employee_id,month,paid_amount)
        VALUES (1,'2024-09',50)`);
      statements.length = 0;
      status = await readSavedPayroll("2024-09");
      assert.equal(status.lines[0].paidAmount, 50);
      assert.equal(status.lines[0].balanceAmount, 1_150);
      assert.equal(status.lines[1].paidAmount, 0);
      assert.ok(!statements.some(s => /from "attendance"/i.test(s)));
    });

    await t.test("old source edits block only the affected employee until the baseline is reviewed again", async () => {
      await query(`INSERT INTO attendance (employee_id,date,clock_in,clock_out,hours,status)
        VALUES (1,'2024-08-10','08:00','16:00',8,'present')`);
      const view = await readSavedPayroll("2024-09");
      assert.equal(view.lines[0].openingBalanceReviewRequired, true);
      assert.equal(view.lines[1].openingBalanceReviewRequired, false);
      await assert.rejects(refreshEmployeePayroll("2024-09", 1), PayrollOpeningConflict);
      const other = await refreshEmployeePayroll("2024-09", 2);
      assert.equal(other.payroll.lines[1].gross, 200);
      const draft = await payrollOpeningDraft("2024-08");
      const confirmed = await confirmPayrollOpening({
        month: "2024-08", revision: draft.revision, sourceRevision: draft.sourceRevision,
        note: "8 сарын өөрчлөлтийг тулгасан", verified: true,
        lines: [{ employeeId: 1, balanceAmount: 1_200 }],
      }, 7);
      assert.deepEqual(confirmed.reviewEmployeeIds, []);
      assert.equal((await readSavedPayroll("2024-09")).lines[0].balanceAmount, 1_350);
      const audits = await query(`SELECT id FROM payroll_opening_balances ORDER BY id`);
      assert.equal(audits.rows.length, 2);
    });
    await t.test("HTTP roles enforce admin-only confirmation and employee-scoped refresh", async () => {
      await query(`INSERT INTO users (id,username,normalized_username,role,password_hash)
        VALUES (1,'opening-admin','opening-admin','admin','fixture')`);
      const [user] = await db.select().from(usersTable);
      const server = app.listen(0);
      try {
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
        const request = async (role: StaffRole, path: string, body?: object) => {
          await query("UPDATE users SET role=$1 WHERE id=1", [role]);
          return fetch(base + path, {
            method: body ? "POST" : "GET",
            headers: { Cookie: `${hrCookie.name}=${createStaffSession({ ...user, role })}`, "Content-Type": "application/json" },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
        };
        const preview = await request("admin", "/payroll/opening-balances?month=2024-08");
        assert.equal(preview.status, 200, await preview.clone().text());
        const draft = await preview.json() as Awaited<ReturnType<typeof payrollOpeningDraft>>;
        assert.equal((await request("accountant", "/payroll/opening-balances?month=2024-08")).status, 200);
        assert.equal((await request("hr", "/payroll/opening-balances?month=2024-08")).status, 403);
        const body = { month: "2024-08", revision: draft.revision, sourceRevision: draft.sourceRevision,
          note: "Зөвшөөрөгдсөн дүн", verified: true, lines: [{ employeeId: 1, balanceAmount: 1_200 }] };
        assert.equal((await request("accountant", "/payroll/opening-balances", body)).status, 403);
        assert.equal((await request("viewer", "/payroll/2024-09/employees/1/refresh", {})).status, 403);
        const hr = await request("hr", "/payroll/2024-09/employees/1/refresh", {});
        assert.equal(hr.status, 200, await hr.clone().text());
        await query(`INSERT INTO attendance (employee_id,date,clock_in,clock_out,hours,status)
          VALUES (2,'2024-09-10','08:00','16:00',8,'present')`);
        assert.equal((await request("admin", "/payroll/opening-balances", body)).status, 409);
      } finally {
        server.close();
      }
    });
    await t.test("refresh repairs dirty months before a corrected joined date without erasing payments or other employees", async () => {
      await query(`INSERT INTO employees (id,name,role,employee_type,salary_type,base_salary,payroll_tax_exempt,joined_at,pay_frequency)
        VALUES (3,'Joined-date correction','Test','shift','daily',1000,true,'2024-09-01','twice')`);
      await query(`INSERT INTO employee_salary_history (employee_id,effective_from,employee_type,salary_type,base_salary,payroll_tax_exempt,pay_frequency)
        VALUES (3,'2024-09-01','shift','daily',1000,true,'twice')`);
      await query(`INSERT INTO attendance (employee_id,date,clock_in,clock_out,hours,status)
        VALUES (3,'2024-09-08','08:00','16:00',8,'present'),
               (3,'2024-10-08','08:00','16:00',8,'present')`);
      await query(`INSERT INTO payroll_adjustments (employee_id,month,paid_amount)
        VALUES (3,'2024-09',50)`);
      await query(`INSERT INTO payroll_advance_approvals (month,lines,total_amount,approval_date)
        VALUES ('2024-09','[{"employeeId":3,"employeeName":"Joined-date correction","employeeType":"shift","baseSalary":1000,"daysWorked":1,"dailySalary":1000,"totalSalary":1000,"advanceAmount":25,"paid":true,"paymentDate":"2024-09-15"}]',25,'2024-09-15')`);
      await refreshEmployeePayroll("2024-09", 3);
      await query(`UPDATE employees SET joined_at='2024-10-01' WHERE id=3`);
      await query(`UPDATE employee_salary_history SET effective_from='2024-10-01' WHERE employee_id=3`);
      const before = await query(`SELECT lines,dirty_employee_ids FROM payroll_month_balances WHERE month='2024-09'`);
      assert.ok(before.rows[0].dirty_employee_ids.includes(3));
      const otherLines = before.rows[0].lines.filter((line: { employeeId: number }) => line.employeeId !== 3);
      const sourceBefore = await query(`SELECT paid_amount FROM payroll_adjustments WHERE employee_id=3 AND month='2024-09'`);
      const advanceBefore = await query(`SELECT lines FROM payroll_advance_approvals WHERE month='2024-09'`);
      statements.length = 0;
      const refreshed = await refreshEmployeePayroll("2024-10", 3);
      const current = refreshed.payroll.lines.find(line => line.employeeId === 3)!;
      assert.equal(current.gross, 1_000);
      assert.equal(current.carryoverAmount, -75);
      assert.equal(current.balanceAmount, 925);
      const after = await query(`SELECT lines,dirty_employee_ids,earnings_dirty_employee_ids FROM payroll_month_balances WHERE month='2024-09'`);
      const prior = after.rows[0].lines.find((line: { employeeId: number }) => line.employeeId === 3);
      assert.equal(prior.movement, -75);
      assert.equal(prior.balanceAmount, -75);
      assert.ok(!after.rows[0].dirty_employee_ids.includes(3));
      assert.ok(!after.rows[0].earnings_dirty_employee_ids.includes(3));
      assert.deepEqual(after.rows[0].lines.filter((line: { employeeId: number }) => line.employeeId !== 3), otherLines);
      assert.deepEqual((await query(`SELECT paid_amount FROM payroll_adjustments WHERE employee_id=3 AND month='2024-09'`)).rows, sourceBefore.rows);
      assert.deepEqual((await query(`SELECT lines FROM payroll_advance_approvals WHERE month='2024-09'`)).rows, advanceBefore.rows);
    });
    await t.test("explicit pull replaces a clean legacy 756,000 insurance base with the fixed 792,000 base", async () => {
      await query(`INSERT INTO employees
        (id,name,role,employee_type,salary_type,base_salary,social_insurance_salary,
         monthly_expected_work_days,payroll_tax_exempt,joined_at,pay_frequency)
        VALUES (4,'Minimum insurance regression','Test','shift','daily',36000,792000,22,false,'2024-09-01','twice')`);
      await query(`INSERT INTO employee_salary_history
        (employee_id,effective_from,employee_type,salary_type,base_salary,social_insurance_salary,
         monthly_expected_work_days,payroll_tax_exempt,pay_frequency)
        VALUES (4,'2024-09-01','shift','daily',36000,792000,22,false,'twice')`);
      await query(`INSERT INTO attendance (employee_id,date,clock_in,clock_out,hours,status)
        SELECT 4,d::date,'08:00','16:00',8,'present'
        FROM generate_series('2024-09-01'::date,'2024-09-21'::date,'1 day') d`);
      await query(`INSERT INTO payroll_adjustments (employee_id,month,paid_amount)
        VALUES (4,'2024-09',12345)`);
      const initial = await refreshEmployeePayroll("2024-09", 4);
      const initialLine = initial.payroll.lines.find(l => l.employeeId === 4)!;
      assert.equal(initialLine.socialInsuranceSalary, 792_000);
      assert.equal(initialLine.gross, 756_000);
      const otherLines = initial.payroll.lines.filter(l => l.employeeId !== 4);

      // Recreate a snapshot written by the former attendance-prorated rule,
      // without changing any source attendance or salary history.
      const legacy = { ...initial.payroll, lines: initial.payroll.lines.map(l => l.employeeId === 4
        ? { ...l, socialInsuranceSalary: 756_000, socialInsurance: 86_940,
          taxableIncome: 669_060, calculatedIncomeTax: 66_906, incomeTax: 48_906 }
        : l) };
      await query(`UPDATE payroll_attendance_snapshots SET payroll=$1::jsonb,
        pulled_at='2024-10-01T00:00:00Z' WHERE month='2024-09'`, [JSON.stringify(legacy)]);
      const before = await readSavedPayroll("2024-09");
      const beforeLine = before.lines.find(l => l.employeeId === 4)!;
      assert.equal(beforeLine.socialInsuranceSalary, 756_000);
      assert.equal(beforeLine.attendanceNeedsRefresh, false);

      const result = await refreshEmployeePayroll("2024-09", 4);
      const line = result.payroll.lines.find(l => l.employeeId === 4)!;
      assert.equal(line.daysWorked, 21);
      assert.equal(line.gross, 756_000);
      assert.equal(line.socialInsuranceSalary, 792_000);
      assert.equal(line.socialInsurance, 91_080);
      assert.equal(line.incomeTax, 52_092);
      assert.equal(line.paidAmount, 12_345);
      assert.equal(line.balanceAmount, 600_483);
      assert.deepEqual(result.payroll.lines.filter(l => l.employeeId !== 4), otherLines);
      const saved = await readSavedPayroll("2024-09");
      assert.equal(saved.lines.find(l => l.employeeId === 4)!.socialInsuranceSalary, 792_000);
      const snapshot = await query(`SELECT pulled_at FROM payroll_attendance_snapshots WHERE month='2024-09'`);
      assert.ok(new Date(snapshot.rows[0].pulled_at) > new Date('2024-10-01T00:00:00Z'));
    });
    await t.test("register excludes debt-only and unpaid absence rows, keeping worked and effective guaranteed staff", async () => {
      await query(`INSERT INTO employees
        (id,name,role,employee_type,salary_type,base_salary,payroll_tax_exempt,joined_at,pay_frequency,full_salary_regardless_attendance,inactive_at)
        VALUES
          (20,'Debt only payable','Test','shift','daily',100,true,'2024-07-01','twice',false,null),
          (21,'Debt only receivable','Test','shift','daily',100,true,'2024-07-01','twice',false,null),
          (22,'New worked late','Test','shift','daily',100,true,'2024-09-01','twice',false,null),
          (23,'Leave only','Test','office','monthly',2000,true,'2024-09-01','twice',false,null),
          (24,'Guaranteed no attendance','Test','office','monthly',2000,true,'2024-09-01','twice',true,null),
          (25,'Future guarantee','Test','shift','monthly',2000,true,'2024-09-01','twice',true,null),
          (26,'History gap','Test','office','monthly',2000,true,'2024-09-01','twice',true,null),
          (27,'Ended before work','Test','shift','daily',100,true,'2024-08-01','twice',false,'2024-08-31'),
          (28,'Not yet joined','Test','shift','daily',100,true,'2024-10-01','twice',false,null),
          (29,'Historical guarantee','Test','shift','monthly',2000,true,'2024-09-01','twice',false,null)`);
      await query(`INSERT INTO employee_salary_history
        (employee_id,effective_from,employee_type,salary_type,base_salary,payroll_tax_exempt,pay_frequency,full_salary_regardless_attendance)
        SELECT id,joined_at,employee_type,salary_type,base_salary,true,'twice',false
        FROM employees WHERE id BETWEEN 20 AND 29 AND id NOT IN (24,26,29)`);
      await query(`INSERT INTO employee_salary_history
        (employee_id,effective_from,employee_type,salary_type,base_salary,payroll_tax_exempt,pay_frequency,full_salary_regardless_attendance)
        VALUES (25,'2024-10-01','shift','monthly',2000,true,'twice',true),
          (26,'2024-10-01','office','monthly',2000,true,'twice',true),
          (29,'2024-09-01','shift','monthly',2000,true,'twice',true),
          (29,'2024-10-01','shift','monthly',2000,true,'twice',false)`);
      await query(`INSERT INTO attendance (employee_id,date,clock_in,clock_out,hours,status)
        VALUES (22,'2024-09-07','08:00','16:00',8,'late'),
          (23,'2024-09-06','00:00','00:00',0,'leave'),
          (23,'2024-09-07','00:00','00:00',0,'absent'),
          (27,'2024-09-06','08:00','16:00',8,'present'),
          (28,'2024-09-06','08:00','16:00',8,'present')`);
      await query(`UPDATE payroll_month_balances SET lines=lines ||
        '[{"employeeId":20,"movement":0,"balanceAmount":4000},{"employeeId":21,"movement":0,"balanceAmount":-3000}]'::jsonb
        WHERE month='2024-08'`);
      const financialTables = ["payroll_month_balances", "payroll_attendance_snapshots", "payroll_adjustments", "payroll_advance_approvals"];
      const before = await Promise.all(financialTables.map(table => query(`SELECT * FROM ${table} ORDER BY month`)));
      const full = await readSavedPayroll("2024-09");
      assert.equal(full.lines.find(l => l.employeeId === 20)?.carryoverAmount, 4000);
      assert.equal(full.lines.find(l => l.employeeId === 21)?.carryoverAmount, -3000);
      statements.length = 0;
      const register = await readPayrollRegister("2024-09");
      assert.deepEqual(register.lines.filter(l => l.employeeId >= 20).map(l => l.employeeId), [22, 24, 29]);
      assert.equal(register.lines.find(l => l.employeeId === 22)?.calculationReady, false);
      assert.equal(register.totalNet, register.lines.reduce((sum, l) => sum + l.net, 0));
      assert.equal(register.totalGross, full.totalGross);
      assert.ok(!statements.some(s => /^\s*(insert|update|delete)\b/i.test(s)), "register GET must never write");
      const after = await Promise.all(financialTables.map(table => query(`SELECT * FROM ${table} ORDER BY month`)));
      assert.deepEqual(after.map(r => r.rows), before.map(r => r.rows), "all debt, payment and saved earnings records remain unchanged");

      await query("UPDATE users SET role='admin' WHERE id=1");
      const [user] = await db.select().from(usersTable);
      const server = app.listen(0);
      try {
        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payroll?month=2024-09`,
          { headers: { Cookie: `${hrCookie.name}=${createStaffSession({ ...user, role: "admin" })}` } });
        assert.equal(response.status, 200, await response.clone().text());
        const body = await response.json() as typeof register;
        assert.deepEqual(body.lines.map(l => l.employeeId), register.lines.map(l => l.employeeId));
      } finally {
        server.close();
      }
      // After an explicit pull, the saved calculation remains visible on reopening.
      const refreshed = await refreshEmployeePayroll("2024-09", 22);
      assert.equal(refreshed.payroll.lines.find(l => l.employeeId === 22)?.gross, 100);
      assert.equal((await readPayrollRegister("2024-09")).lines.find(l => l.employeeId === 22)?.gross, 100);
      assert.equal((await readSavedPayroll("2024-09")).lines.find(l => l.employeeId === 20)?.carryoverAmount, 4000);
    });
  } finally {
    t.mock.restoreAll();
    await query("RESET search_path");
    await query(`DROP SCHEMA ${schema} CASCADE`);
    client.release();
  }
});
