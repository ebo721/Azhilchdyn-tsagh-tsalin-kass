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
      status = (await refreshEmployeePayroll("2024-09", 1)).payroll;
      assert.equal(status.lines[0].gross, 200);
      assert.equal(status.lines[1].gross, 200);
      await query(`INSERT INTO payroll_adjustments (employee_id,month,paid_amount)
        VALUES (1,'2024-09',50)`);
      statements.length = 0;
      status = (await refreshEmployeePayroll("2024-09", 1)).payroll;
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
  } finally {
    t.mock.restoreAll();
    await query("RESET search_path");
    await query(`DROP SCHEMA ${schema} CASCADE`);
    client.release();
  }
});
