import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { after, it } from "node:test";
import { db, pool, usersTable } from "@workspace/db";
import app from "../app.js";
import { createStaffSession, hrCookie } from "./hr-session.js";
import { rebuildPayrollBalances } from "./payroll-balance-store.js";

after(() => pool.end());

it("closed payroll is immutable, permissioned and a saved carryover boundary", async (t) => {
  const schema = `payroll_close_test_${Date.now()}`;
  const client = await pool.connect();
  const query = client.query.bind(client);
  const statements: string[] = [];
  await query(`CREATE SCHEMA ${schema}`);
  const server = app.listen(0);
  try {
    for (const table of ["users", "employees", "employee_salary_history", "attendance",
      "payroll_adjustments", "payroll_advance_approvals", "payroll_schedule_settings"]) {
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
    await query("INSERT INTO users (id,username,normalized_username,role,password_hash) VALUES (1,'close-fixture','close-fixture','admin','fixture')");
    await query(`INSERT INTO employees (id,name,role,employee_type,salary_type,base_salary,payroll_tax_exempt,joined_at,pay_frequency)
      VALUES (1,'Original employee','Fixture','shift','daily',100,true,'2024-01-01','twice')`);
    await query(`INSERT INTO employee_salary_history (employee_id,effective_from,employee_type,salary_type,base_salary,payroll_tax_exempt,pay_frequency)
      VALUES (1,'2024-01-01','shift','daily',100,true,'twice')`);
    await query("INSERT INTO payroll_schedule_settings(effective_from_month) VALUES ('0001-01')");
    await query("INSERT INTO attendance(employee_id,date,clock_in,clock_out,hours,status) VALUES (1,'2024-01-05','08:00','16:00',8,'present')");
    await query("INSERT INTO payroll_adjustments(employee_id,month,paid_amount) VALUES (1,'2024-01',50)");
    const user = (await db.select().from(usersTable))[0];
    let cookie = `${hrCookie.name}=${createStaffSession(user)}`;
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const request = (path: string, body?: object) => fetch(base + path, {
      method: body ? "POST" : "GET", headers: { Cookie: cookie, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const setRole = async (role: string) => {
      await query("UPDATE users SET role=$1 WHERE id=1", [role]);
      cookie = `${hrCookie.name}=${createStaffSession({ ...user, role })}`;
    };
    const checkedJson = async (response: Response, status = 200) => {
      assert.equal(response.status, status, await response.clone().text());
      return response.json();
    };
    const attendanceReads = () => statements.filter(s => /from "attendance"/i.test(s));
    let frozen: Record<string, unknown>;
    await t.test("missing calculation cannot be closed; accountant can close a saved calculation", async () => {
      await checkedJson(await request("/payroll/2024-01/close", {}), 409);
      await checkedJson(await request("/payroll/pull-attendance", { month: "2024-01" }));
      await setRole("hr");
      await checkedJson(await request("/payroll/2024-01/close", {}), 403);
      await setRole("viewer");
      await checkedJson(await request("/payroll/2024-01/close", {}), 403);
      await setRole("accountant");
      statements.length = 0;
      frozen = await checkedJson(await request("/payroll/2024-01/close", {}));
      assert.ok(frozen.closedAt);
      assert.equal(frozen.closedBy, 1);
      assert.equal(attendanceReads().length, 0, "closing must not pull attendance");
      assert.equal((await query("SELECT lines->0->>'balanceAmount' AS amount,dirty FROM payroll_month_balances WHERE month='2024-01'")).rows[0].amount, "50");
    });
    await t.test("repeated close and GET return the same frozen summary without source reads", async () => {
      statements.length = 0;
      assert.deepEqual(await checkedJson(await request("/payroll/2024-01/close", {})), frozen!);
      assert.deepEqual(await checkedJson(await request("/payroll?month=2024-01")), frozen!);
      assert.equal(attendanceReads().length, 0);
      assert.equal(statements.filter(s => /from "(employees|payroll_adjustments|payroll_advance_approvals)"/i.test(s)).length, 0);
      await checkedJson(await request("/payroll/pull-attendance", { month: "2024-01" }), 409);
    });
    await t.test("all source-write paths reject changes to the closed period", async () => {
      for (const sql of [
        "UPDATE attendance SET hours=9 WHERE employee_id=1 AND date='2024-01-05'",
        "DELETE FROM attendance WHERE employee_id=1 AND date='2024-01-05'",
        "INSERT INTO attendance(employee_id,date,hours,status) VALUES (1,'2024-01-06',8,'present')",
        "UPDATE payroll_adjustments SET paid_amount=90 WHERE employee_id=1 AND month='2024-01'",
        `UPDATE payroll_adjustments SET additional_payments='[{"sequence":3,"amount":20,"date":"2024-01-20"}]' WHERE employee_id=1 AND month='2024-01'`,
        "INSERT INTO payroll_advance_approvals(month,approval_date,lines) VALUES ('2024-01','2024-01-15','[]')",
        "UPDATE payroll_schedule_settings SET period_end_day=20 WHERE effective_from_month='0001-01'",
        "UPDATE payroll_month_balances SET lines='[]' WHERE month='2024-01'",
        "DELETE FROM payroll_month_balances WHERE month='2024-01'",
        "DELETE FROM payroll_attendance_snapshots WHERE month='2024-01'",
      ]) {
        await assert.rejects(query(sql), (error: { code?: string }) => error.code === "PCL01", sql);
      }
    });
    await t.test("employee edits invalidate open periods, never rewrite a closed identity or balance", async () => {
      await query("UPDATE employees SET name='Changed employee',base_salary=200 WHERE id=1");
      assert.equal((await query("SELECT dirty FROM payroll_month_balances WHERE month='2024-01'")).rows[0].dirty, false);
      assert.deepEqual(await checkedJson(await request("/payroll?month=2024-01")), frozen!);
    });
    await t.test("new month uses finalized carryover; repairs skip closed attendance and preserve frozen records", async () => {
      await query("INSERT INTO attendance(employee_id,date,clock_in,clock_out,hours,status) VALUES (1,'2024-02-05','08:00','16:00',8,'present')");
      const feb = await checkedJson(await request("/payroll/pull-attendance", { month: "2024-02" }));
      assert.equal(feb.payroll.lines[0].carryoverAmount, 50);
      statements.length = 0;
      await rebuildPayrollBalances("2024-01");
      assert.equal(attendanceReads().length, 0, "repair through closed month must use frozen balance");
      assert.deepEqual(await checkedJson(await request("/payroll?month=2024-01")), frozen!);
      const closedFeb = await checkedJson(await request("/payroll/2024-02/close", {}));
      assert.ok(closedFeb.closedAt);
    });
    await t.test("only administrator reopens, and later closures must reopen newest first", async () => {
      await checkedJson(await request("/payroll/2024-02/reopen", {}), 403);
      await setRole("admin");
      await checkedJson(await request("/payroll/2024-01/reopen", {}), 409);
      const reopened = await checkedJson(await request("/payroll/2024-02/reopen", {}));
      assert.equal(reopened.closedAt, null);
      await checkedJson(await request("/payroll/2024-01/reopen", {}));
      await query("UPDATE attendance SET hours=16 WHERE employee_id=1 AND date='2024-01-05'");
      assert.equal((await query("SELECT dirty FROM payroll_month_balances WHERE month='2024-01'")).rows[0].dirty, true);
      const pulled = await checkedJson(await request("/payroll/pull-attendance", { month: "2024-01" }));
      assert.equal(pulled.payroll.lines[0].hours, 16);
    });
  } finally {
    t.mock.restoreAll();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await query("SET search_path TO public");
    await query(`DROP SCHEMA ${schema} CASCADE`);
    client.release();
  }
});
