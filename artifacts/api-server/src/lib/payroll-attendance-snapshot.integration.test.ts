import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { after, it } from "node:test";
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { db, pool, usersTable } from "@workspace/db";
import app from "../app.js";
import { createStaffSession, hrCookie } from "./hr-session.js";

after(() => pool.end());

it("real SQL and HTTP: payroll reads saved earnings; only explicit pull reads attendance", async (t) => {
  const schema = `payroll_snapshot_test_${Date.now()}`;
  const client = await pool.connect();
  const query = client.query.bind(client);
  const statements: string[] = [];
  await query(`CREATE SCHEMA ${schema}`);
  const server = app.listen(0);
  try {
    for (const table of ["users", "employees", "employee_salary_history", "attendance", "payroll_adjustments",
      "payroll_advance_approvals", "payroll_schedule_settings"]) {
      await query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    for (const migration of ["20261008_payroll_month_balances.sql", "20261010_payroll_attendance_snapshots.sql", "20261019_payroll_month_closures.sql", "20261022_payroll_opening_selective.sql"]) {
      await query(readFileSync(new URL(`../../../../lib/db/migrations/${migration}`, import.meta.url), "utf8").replaceAll("public.", `${schema}.`));
    }
    await query(`SET search_path TO ${schema}`);
    const auditedQuery = ((config: { text: string } | string, values?: unknown[]) => {
      statements.push(typeof config === "string" ? config : config.text);
      return query(config as never, values as never);
    }) as typeof client.query;
    t.mock.method(pool, "connect", (() => Promise.resolve({ query: auditedQuery, release() {} } as unknown as typeof client)) as typeof pool.connect);
    t.mock.method(pool, "query", auditedQuery as typeof pool.query);
    await query("INSERT INTO users (id, username, normalized_username, role, password_hash) VALUES (1,'snapshot-fixture','snapshot-fixture','admin','invalid-test-hash')");
    await query(`INSERT INTO employees (id,name,role,employee_type,salary_type,base_salary,payroll_tax_exempt,joined_at,pay_frequency)
      VALUES (1,'Snapshot fixture','Test','shift','daily',100,true,'2024-01-01','twice')`);
    await query(`INSERT INTO employee_salary_history (employee_id,effective_from,employee_type,salary_type,base_salary,payroll_tax_exempt,pay_frequency)
      VALUES (1,'2024-01-01','shift','daily',100,true,'twice')`);
    await query("INSERT INTO attendance (employee_id,date,clock_in,clock_out,hours,status) VALUES (1,'2024-01-05','08:00','16:00',8,'present')");
    await query("INSERT INTO payroll_adjustments (employee_id,month,paid_amount) VALUES (1,'2024-01',50)");
    const [user] = await db.select().from(usersTable);
    const cookie = `${hrCookie.name}=${createStaffSession(user)}`;
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const request = (path: string, body?: object) => fetch(base + path, {
      method: body ? "POST" : "GET", headers: { Cookie: cookie, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const attendanceReads = () => statements.filter((text) => /from "attendance"/i.test(text));
    const writes = () => statements.filter((text) => /\b(insert into|update |delete from)\b/i.test(text));

    await t.test("new month needs explicit pull; GET never creates a calculation", async () => {
      statements.length = 0;
      assert.equal((await request("/payroll?month=2024-01")).status, 409);
      assert.equal((await request("/payroll-advance?month=2024-01")).status, 409);
      assert.equal(attendanceReads().length, 0);
      assert.equal(writes().length, 0);
      await query("INSERT INTO payroll_schedule_settings (effective_from_month) VALUES ('0001-01')");
    });
    await t.test("button endpoint atomically saves payroll and advance without changing paid money", async () => {
      statements.length = 0;
      const response = await request("/payroll/pull-attendance", { month: "2024-01" });
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json() as { payroll: { lines: Array<{ gross: number; hours: number; paidAmount: number }>; attendancePulledAt: string }; advance: { lines: unknown[] } };
      assert.equal(result.payroll.lines[0].gross, 100);
      assert.equal(result.payroll.lines[0].hours, 8);
      assert.equal(result.payroll.lines[0].paidAmount, 50);
      assert.ok(result.payroll.attendancePulledAt);
      assert.equal(result.advance.lines.length, 1);
      assert.equal(attendanceReads().length, 2);
    });
    await t.test("new login/repeated GET reads cached hours, performs no writes or attendance queries", async () => {
      await query("INSERT INTO attendance (employee_id,date,clock_in,clock_out,hours,status) VALUES (1,'2024-01-08','08:00','16:00',8,'present')");
      statements.length = 0;
      for (let repeat = 0; repeat < 3; repeat++) {
        const response = await request("/payroll?month=2024-01");
        assert.equal(response.status, 200);
        const result = await response.json() as { lines: Array<{ gross: number; hours: number }>; attendanceNeedsRefresh: boolean };
        assert.equal(result.lines[0].gross, 100);
        assert.equal(result.lines[0].hours, 8);
        assert.equal(result.attendanceNeedsRefresh, true);
        assert.equal((await request("/payroll-advance?month=2024-01")).status, 200);
      }
      assert.equal(attendanceReads().length, 0);
      assert.equal(writes().length, 0);
    });
    await t.test("payments and manual deductions remain live without changing saved hours", async () => {
      await query("UPDATE payroll_adjustments SET paid_amount=75, manual_deduction=10 WHERE month='2024-01'");
      statements.length = 0;
      const response = await request("/payroll?month=2024-01");
      const result = await response.json() as { lines: Array<{ gross: number; hours: number; paidAmount: number; manualDeduction: number; balanceAmount: number }> };
      assert.equal(response.status, 200);
      assert.equal(result.lines[0].gross, 100);
      assert.equal(result.lines[0].hours, 8);
      assert.equal(result.lines[0].paidAmount, 75);
      assert.equal(result.lines[0].manualDeduction, 10);
      assert.equal(result.lines[0].balanceAmount, 15);
      assert.equal(attendanceReads().length, 0);
    });
    await t.test("explicit repull updates hours but preserves approved advance and recorded payment", async () => {
      const advanceResponse = await request("/payroll-advance?month=2024-01");
      const draft = await advanceResponse.json() as { lines: Array<Record<string, unknown>> };
      statements.length = 0;
      const approved = await request("/payroll-advance/approve", {
        month: "2024-01", approvalDate: "2024-01-15", lines: [{ employeeId: 1, advanceAmount: 123 }],
      });
      assert.equal(approved.status, 200, await approved.clone().text());
      assert.equal(attendanceReads().length, 0);
      assert.equal(((await approved.json()) as { lines: Array<{ daysWorked: number }> }).lines[0].daysWorked, draft.lines[0].daysWorked);
      statements.length = 0;
      const response = await request("/payroll/pull-attendance", { month: "2024-01" });
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json() as { payroll: { lines: Array<{ gross: number; hours: number; paidAmount: number }> }; advance: { approved: boolean; totalAmount: number } };
      assert.equal(result.payroll.lines[0].gross, 200);
      assert.equal(result.payroll.lines[0].hours, 16);
      assert.equal(result.payroll.lines[0].paidAmount, 75);
      assert.equal(result.advance.approved, true);
      assert.equal(result.advance.totalAmount, 123);
      assert.equal(attendanceReads().length, 2);
      statements.length = 0;
      assert.equal((await request("/payroll?month=2024-01")).status, 200);
      assert.equal((await request("/payroll-advance?month=2024-01")).status, 200);
      assert.equal(attendanceReads().length, 0);
      assert.equal(writes().length, 0);
    });
    await t.test("read-only roles cannot pull, and a failed pull leaves no partial snapshot", async () => {
      await query("UPDATE users SET role='viewer' WHERE id=1");
      assert.equal((await request("/payroll/pull-attendance", { month: "2024-01" })).status, 403);
      await query("UPDATE users SET role='admin' WHERE id=1");
      assert.equal((await request("/payroll/pull-attendance", { month: "2024-03" })).status, 409);
      const snapshots = await query("SELECT month FROM payroll_attendance_snapshots");
      assert.deepEqual(snapshots.rows.map((row) => row.month), ["2024-01"]);
    });
    await t.test("snapshot-write failure rolls back recalculated balances and keeps the previous saved result", async () => {
      await query("UPDATE attendance SET status='absent' WHERE date='2024-01-08'");
      const before = await query("SELECT lines,dirty,updated_at FROM payroll_month_balances WHERE month='2024-01'");
      await query(`CREATE FUNCTION ${schema}.reject_snapshot_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture snapshot failure'; END $$;
        CREATE TRIGGER reject_snapshot BEFORE INSERT OR UPDATE ON payroll_attendance_snapshots FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_snapshot_write()`);
      assert.equal((await request("/payroll/pull-attendance", { month: "2024-01" })).status, 500);
      const afterFailure = await query("SELECT lines,dirty,updated_at FROM payroll_month_balances WHERE month='2024-01'");
      assert.deepEqual(afterFailure.rows, before.rows);
      const previous = await request("/payroll?month=2024-01");
      assert.equal(((await previous.json()) as { lines: Array<{ hours: number }> }).lines[0].hours, 16);
      await query("DROP TRIGGER reject_snapshot ON payroll_attendance_snapshots");
    });
    await t.test("office pull pays only present/late dates and preserves recorded salary and advance payments", async () => {
      await query(`INSERT INTO employees (id,name,role,employee_type,salary_type,base_salary,payroll_tax_exempt,joined_at)
        VALUES (2,'Office attendance fixture','Test','office','monthly',2300,true,'2024-01-01')`);
      await query(`INSERT INTO employee_salary_history (employee_id,effective_from,employee_type,salary_type,base_salary,payroll_tax_exempt)
        VALUES (2,'2024-01-01','office','monthly',2300,true)`);
      await query(`INSERT INTO attendance (employee_id,date,clock_in,clock_out,hours,status) VALUES
        (2,'2024-01-02','08:00','16:00',8,'present'),(2,'2024-01-03','08:00','08:00',0,'absent'),
        (2,'2024-01-04','08:00','08:00',0,'leave'),(2,'2024-01-06','09:00','17:00',8,'late')`);
      await query("INSERT INTO payroll_adjustments (employee_id,month,paid_amount) VALUES (2,'2024-01',75)");
      await query(`INSERT INTO payroll_advance_approvals (month,lines,total_amount,approval_date)
        VALUES ('2024-01',$1,50,'2024-01-20')
        ON CONFLICT (month) DO UPDATE SET lines=payroll_advance_approvals.lines || EXCLUDED.lines,
        total_amount=payroll_advance_approvals.total_amount + EXCLUDED.total_amount`, [JSON.stringify([{
        employeeId: 2, employeeName: "Office attendance fixture", employeeType: "office",
        baseSalary: 2300, daysWorked: 2, dailySalary: 0, totalSalary: 2300,
        advanceAmount: 50, paid: true, paymentDate: "2024-01-20",
      }])]);
      const before = await query("SELECT lines,total_amount FROM payroll_advance_approvals WHERE month='2024-01'");
      const response = await request("/payroll/pull-attendance", { month: "2024-01" });
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json() as { payroll: { lines: Array<{ employeeId: number; gross: number; paidAmount: number; advanceAmount: number; balanceAmount: number }> } };
      const office = result.payroll.lines.find(line => line.employeeId === 2)!;
      assert.equal(office.gross, 200); // 2300 / 23 weekdays * 2 actual days.
      assert.equal(office.paidAmount, 75);
      assert.equal(office.advanceAmount, 50);
      assert.equal(office.balanceAmount, 75);
      assert.deepEqual((await query("SELECT lines,total_amount FROM payroll_advance_approvals WHERE month='2024-01'")).rows, before.rows);
      assert.equal((await query("SELECT paid_amount FROM payroll_adjustments WHERE employee_id=2 AND month='2024-01'")).rows[0].paid_amount, "75.00");
      const saved = await request("/payroll?month=2024-01");
      const lines = (await saved.json() as { lines: typeof result.payroll.lines }).lines;
      assert.equal(lines.find(line => line.employeeId === 2)?.gross, 200);
    });
    await t.test("payroll Excel exports saved salary without attendance reads or writes", async () => {
      statements.length = 0;
      const response = await request("/payroll/export?month=2024-01");
      assert.equal(response.status, 200, await response.clone().text());
      assert.match(response.headers.get("content-type") ?? "", /spreadsheetml/);
      assert.match(response.headers.get("content-disposition") ?? "", /Payroll-2024-01.xlsx/);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as never);
      const sheet = workbook.worksheets[0];
      const office = sheet.getRows(5, 2)!.find(row => row.getCell(4).value === "Office attendance fixture")!;
      assert.equal(office.getCell(13).value, 200);
      assert.equal(office.getCell(18).value, 50);
      assert.equal(office.getCell(20).value, 150);
      assert.equal(office.getCell(21).value, 75);
      assert.equal(attendanceReads().length, 0);
      assert.equal(writes().length, 0);
      assert.equal((await request("/payroll/export?month=2024-13")).status, 400);
    });
    await t.test("Excel payroll export denies unauthorized roles, including trailing-slash routes", async () => {
      await query("INSERT INTO users (id,username,normalized_username,role,password_hash) VALUES (2,'export-viewer','export-viewer','viewer','invalid-test-hash')");
      const [viewer] = await db.select().from(usersTable).where(eq(usersTable.id, 2));
      const viewerCookie = `${hrCookie.name}=${createStaffSession(viewer)}`;
      for (const path of ["/payroll/export?month=2024-01", "/payroll/export/?month=2024-01"]) {
        const response = await fetch(base + path, { headers: { Cookie: viewerCookie } });
        assert.equal(response.status, 403);
      }
      assert.equal((await fetch(base + "/payroll/export?month=2024-01")).status, 401);
      await query("UPDATE users SET role='accountant' WHERE id=2");
      const [accountant] = await db.select().from(usersTable).where(eq(usersTable.id, 2));
      const accountantCookie = `${hrCookie.name}=${createStaffSession(accountant)}`;
      assert.equal((await fetch(base + "/payroll/export?month=2024-01", { headers: { Cookie: accountantCookie } })).status, 200);
    });
    await t.test("invalid historical debt requests explicit repair instead of silently serving stale carryover", async () => {
      await query(`INSERT INTO payroll_month_balances (month,period_start,period_end,lines,dirty)
        VALUES ('2023-12','2023-12-01','2023-12-31','[]',true)`);
      statements.length = 0;
      const response = await request("/payroll?month=2024-01");
      assert.equal(response.status, 409);
      assert.match((await response.json() as { error: string }).error, /өмнөх сарын/);
      assert.equal(attendanceReads().length, 0);
      assert.equal(writes().length, 0);
      assert.equal((await request("/payroll/export?month=2024-01")).status, 409);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    t.mock.restoreAll();
    await query("RESET search_path");
    await query(`DROP SCHEMA ${schema} CASCADE`);
    client.release();
  }
});
