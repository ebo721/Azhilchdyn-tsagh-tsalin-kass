import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, it } from "node:test";
import { db, pool, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app.js";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";

after(() => pool.end());

it("salary-history tax corrections persist in both directions without rewriting other history or payments", async t => {
  const schema = `salary_tax_test_${Date.now()}`;
  const client = await pool.connect();
  const query = client.query.bind(client);
  const server = app.listen(0);
  try {
    await query(`CREATE SCHEMA ${schema}`);
    for (const table of ["users", "employees", "employee_salary_history", "payroll_adjustments", "payroll_attendance_snapshots"]) {
      await query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    await query(`SET search_path TO ${schema}`);
    t.mock.method(pool, "connect", (() => Promise.resolve({ query, release() {} } as unknown as typeof client)) as typeof pool.connect);
    t.mock.method(pool, "query", query as typeof pool.query);
    await query(`INSERT INTO users(id,username,normalized_username,role,password_hash) VALUES
      (1,'salary-tax-admin','salary-tax-admin','admin','invalid-test-hash'),
      (2,'salary-tax-viewer','salary-tax-viewer','viewer','invalid-test-hash')`);
    await query(`INSERT INTO employees(id,name,role,employee_type,salary_type,base_salary,
      social_insurance_salary,payroll_tax_exempt,joined_at)
      VALUES(1,'Tax status fixture','Test','office','monthly',2000000,1000000,false,'2024-01-01')`);
    await query(`INSERT INTO employee_salary_history(id,employee_id,effective_from,employee_type,
      salary_type,base_salary,social_insurance_salary,payroll_tax_exempt) VALUES
      (1,1,'2024-01-01','office','monthly',2000000,1000000,false),
      (2,1,'2024-02-01','office','monthly',2000000,1000000,false)`);
    await query(`INSERT INTO payroll_adjustments(employee_id,month,paid_amount,second_paid_amount,payment_date)
      VALUES(1,'2024-01',500000,200000,'2024-01-31')`);
    await query(`INSERT INTO payroll_attendance_snapshots(month,payroll,advance)
      VALUES('2024-01','{"saved":"must remain unchanged"}','{}')`);
    const beforePayments = (await query("SELECT * FROM payroll_adjustments")).rows;
    const beforeSnapshots = (await query("SELECT * FROM payroll_attendance_snapshots")).rows;
    const [admin] = await db.select().from(usersTable).where(eq(usersTable.id, 1));
    const [viewer] = await db.select().from(usersTable).where(eq(usersTable.id, 2));
    const cookie = (user: typeof admin) => `${hrCookie.name}=${createStaffSession(user)}`;
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/employees/1/salary-history`;
    const patch = (id: number, payrollTaxExempt?: unknown, session = cookie(admin)) =>
      fetch(`${base}/${id}`, { method: "PATCH",
        headers: { cookie: session, "content-type": "application/json" },
        body: JSON.stringify({ effectiveFrom: id === 1 ? "2024-01-01" : "2024-02-01",
          baseSalary: 2000000, socialInsuranceSalary: 1000000,
          ...(payrollTaxExempt === undefined ? {} : { payrollTaxExempt }) }) });

    for (const id of [1, 2]) {
      for (const exempt of [true, false]) {
        await t.test(`${id === 1 ? "older" : "latest"} history can become ${exempt ? "exempt" : "taxable"}`, async () => {
          const response = await patch(id, exempt);
          assert.equal(response.status, 200, await response.clone().text());
          assert.equal((await response.json()).payrollTaxExempt, exempt);
          const history = (await query("SELECT id,payroll_tax_exempt FROM employee_salary_history ORDER BY id")).rows;
          assert.equal(history.length, 2);
          assert.equal(history[id - 1].payroll_tax_exempt, exempt);
          assert.equal(history[id === 1 ? 1 : 0].payroll_tax_exempt, false);
          const employee = (await query("SELECT payroll_tax_exempt FROM employees WHERE id=1")).rows[0];
          assert.equal(employee.payroll_tax_exempt, id === 2 ? exempt : false);
          const reread = await fetch(base, { headers: { cookie: cookie(admin) } });
          assert.equal(reread.status, 200);
          const rows = await reread.json() as Array<{ id: number; payrollTaxExempt: boolean }>;
          assert.equal(rows.find(row => row.id === id)!.payrollTaxExempt, exempt);
          assert.deepEqual((await query("SELECT * FROM payroll_adjustments")).rows, beforePayments);
          assert.deepEqual((await query("SELECT * FROM payroll_attendance_snapshots")).rows, beforeSnapshots);
        });
      }
    }
    await t.test("omitting the optional flag preserves its saved value", async () => {
      assert.equal((await patch(2, true)).status, 200);
      const response = await patch(2);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).payrollTaxExempt, true);
      assert.equal((await query("SELECT payroll_tax_exempt FROM employees WHERE id=1")).rows[0].payroll_tax_exempt, true);
    });
    await t.test("invalid flags and read-only users cannot change tax settings", async () => {
      assert.equal((await patch(2, "false")).status, 400);
      assert.equal((await patch(2, false, cookie(viewer))).status, 403);
      assert.equal((await query("SELECT payroll_tax_exempt FROM employees WHERE id=1")).rows[0].payroll_tax_exempt, true);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    t.mock.restoreAll();
    await query("SET search_path TO public");
    await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
  }
});
