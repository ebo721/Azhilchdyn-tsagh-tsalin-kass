import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, it } from "node:test";
import { db, pool, payrollAdjustmentsTable, usersTable } from "@workspace/db";
import app from "../app.js";
import { applyPayrollFinancials } from "./payroll-calc-helpers.js";
import { createStaffSession, hrCookie } from "./hr-session.js";

after(() => pool.end());

it("partial second payment preserves a bank-verified first payment despite another employee's matching bank cash", async (t) => {
  const schema = `payroll_partial_test_${Date.now()}`;
  const client = await pool.connect();
  const query = client.query.bind(client);
  const server = app.listen(0);
  try {
    await query(`CREATE SCHEMA ${schema}`);
    for (const table of ["users", "employees", "payroll_adjustments", "cash_closures", "cash_transactions", "chart_of_accounts"]) {
      await query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    await query(`SET search_path TO ${schema}`);
    t.mock.method(pool, "connect", (() => Promise.resolve({ query, release() {} } as unknown as typeof client)) as typeof pool.connect);
    t.mock.method(pool, "query", query as typeof pool.query);
    await query("INSERT INTO users (id,username,normalized_username,role,password_hash) VALUES (1,'partial-fixture','partial-fixture','admin','invalid-test-hash')");
    await query(`INSERT INTO employees (id,name,role,employee_type,salary_type,base_salary,joined_at)
      VALUES (1,'Partial fixture','Test','shift','daily',100,'2026-01-01')`);
    await query("INSERT INTO chart_of_accounts (code,name,type,normal_balance) VALUES ('6000','Fixture payroll expense','expense','debit')");
    await query(`INSERT INTO payroll_adjustments (employee_id,month,paid_amount,payment_date)
      VALUES (1,'2026-08',700000,'2026-09-04')`);
    await query(`INSERT INTO cash_transactions (type,category,description,amount,date,source_type,source_key,bank_transaction_id,bank_verified_at)
      VALUES ('expense','Цалин','Existing verified first payment',700000,'2026-09-04','payroll','2026-08:1',1,now()),
             ('expense','Цалин','Another employee bank payment',700000,'2026-09-04','bank_transaction','fixture-other-bank',2,now())`);
    const originalCash = (await query("SELECT * FROM cash_transactions WHERE source_key='2026-08:1'")).rows[0];
    const [user] = await db.select().from(usersTable);
    const cookie = `${hrCookie.name}=${createStaffSession(user)}`;
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const payload = {
      employeeId: 1, month: "2026-08", manualDeduction: 0, receivableId: null,
      paidAmount: 700000, paymentDate: "2026-09-04",
      secondPaidAmount: 250000.25, secondPaymentDate: "2026-09-05",
    };
    const save = (body = payload) => fetch(`${base}/payroll-adjustments`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body),
    });
    await t.test("save and resave a smaller second payment without duplicating the first", async () => {
      for (let repeat = 0; repeat < 2; repeat++) {
        const response = await save();
        assert.equal(response.status, 200, await response.clone().text());
        const result = await response.json() as { paidAmount: number; secondPaidAmount: number };
        assert.equal(result.paidAmount, 700000);
        assert.equal(result.secondPaidAmount, 250000.25);
      }
      const cash = (await query("SELECT * FROM cash_transactions WHERE source_key='2026-08:1'")).rows[0];
      assert.equal(cash.id, originalCash.id);
      assert.equal(cash.bank_transaction_id, originalCash.bank_transaction_id);
      assert.equal(cash.bank_verified_at.toISOString(), originalCash.bank_verified_at.toISOString());
      assert.equal(Number(cash.amount), 700000);
      assert.equal((await query("SELECT count(*)::int AS n FROM cash_transactions")).rows[0].n, 3);
      const [adjustment] = await db.select().from(payrollAdjustmentsTable);
      const financials = applyPayrollFinancials({ gross: 1920000, socialInsurance: 0, incomeTax: 0 }, adjustment, 900000, 820000);
      assert.equal(financials.paidAmount, 950000.25);
      assert.equal(financials.balanceAmount, 889999.75);
    });
    await t.test("a genuinely new duplicate bank payment is still rejected", async () => {
      const response = await save({ ...payload, secondPaidAmount: 700000, secondPaymentDate: "2026-09-04" });
      assert.equal(response.status, 409);
      assert.match(await response.text(), /Ижил огноо/);
    });
    await t.test("changing the bank-verified first payment remains forbidden", async () => {
      const response = await save({ ...payload, paidAmount: 699999 });
      assert.equal(response.status, 409);
      assert.match(await response.text(), /Банкны хуулгаар баталгаажсан/);
      assert.equal(Number((await query("SELECT second_paid_amount FROM payroll_adjustments")).rows[0].second_paid_amount), 250000.25);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    t.mock.restoreAll();
    await query("SET search_path TO public");
    await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
  }
});
