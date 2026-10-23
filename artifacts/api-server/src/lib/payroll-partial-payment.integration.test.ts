import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
    for (const table of ["users", "employees", "payroll_adjustments", "cash_closures", "cash_transactions", "chart_of_accounts",
      "bank_accounts", "bank_transactions", "bank_internal_transfers", "journal_entries", "journal_lines", "operating_expenses",
      "receivables", "receivable_allocations", "payables", "payable_allocations"]) {
      await query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    await query(`SET search_path TO ${schema}`);
    t.mock.method(pool, "connect", (() => Promise.resolve({ query, release() {} } as unknown as typeof client)) as typeof pool.connect);
    t.mock.method(pool, "query", query as typeof pool.query);
    await query("INSERT INTO users (id,username,normalized_username,role,password_hash) VALUES (1,'partial-fixture','partial-fixture','admin','invalid-test-hash')");
    await query(`INSERT INTO employees (id,name,role,employee_type,salary_type,base_salary,joined_at)
      VALUES (1,'Partial fixture','Test','shift','daily',100,'2026-01-01')`);
    await query("INSERT INTO chart_of_accounts (code,name,type,normal_balance) VALUES ('6000','Fixture payroll expense','expense','debit'), ('1010','Bank','asset','debit')");
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
    const save = (body: typeof payload & { additionalPayments?: Array<{sequence: number; amount: number; date: string}> } = payload) => fetch(`${base}/payroll-adjustments`, {
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
    const extras = [
      { sequence: 3, amount: 100000.75, date: "2026-09-06" },
      { sequence: 4, amount: 200000, date: "2026-09-07" },
      { sequence: 7, amount: 30000, date: "2026-09-08" },
    ];
    const deletePayment = (sequence: number) => fetch(`${base}/payroll-adjustments/2026-08/1/transactions/${sequence}`, {
      method: "DELETE", headers: { Cookie: cookie },
    });
    await t.test("supports five payments, preserves slot identities and includes all amounts in payroll balances", async () => {
      for (let repeat = 0; repeat < 2; repeat++) {
        const response = await save({ ...payload, additionalPayments: extras });
        assert.equal(response.status, 200, await response.clone().text());
        assert.deepEqual((await response.json()).additionalPayments, extras);
      }
      const rows = (await query("SELECT * FROM cash_transactions WHERE source_type='payroll' ORDER BY source_key")).rows;
      assert.deepEqual(rows.map(row => row.source_key), ["2026-08:1", "2026-08:1:2", "2026-08:1:3", "2026-08:1:4", "2026-08:1:7"]);
      assert.equal(rows[0].id, originalCash.id);
      assert.equal(rows[0].bank_transaction_id, originalCash.bank_transaction_id);
      const [adjustment] = await db.select().from(payrollAdjustmentsTable);
      const financials = applyPayrollFinancials({ gross: 1920000, socialInsurance: 0, incomeTax: 0 }, adjustment, 900000, 820000);
      assert.equal(financials.paidAmount, 1280001);
      assert.equal(financials.balanceAmount, 559999);
      assert.deepEqual(financials.additionalPayments, extras);
      // An older client must not erase new payments.
      assert.equal((await save()).status, 200);
      assert.deepEqual((await db.select().from(payrollAdjustmentsTable))[0].additionalPayments, extras);
    });
    await t.test("rejects duplicate slots, nonexistent dates, invalid amounts and invalid sequences before writes", async () => {
      for (const additionalPayments of [
        [extras[0], extras[0]],
        [{ ...extras[0], date: "2026-02-30" }],
        [{ ...extras[0], amount: 0 }],
        [{ ...extras[0], amount: 1.001 }],
        [{ ...extras[0], sequence: 2 }],
      ]) {
        const response = await save({ ...payload, additionalPayments });
        assert.equal(response.status, 400, await response.clone().text());
        assert.deepEqual((await db.select().from(payrollAdjustmentsTable))[0].additionalPayments, extras);
      }
    });
    await t.test("each extra payment links to its own bank transaction without duplicate expense posting", async () => {
      await query("INSERT INTO bank_accounts (id,bank_name,account_number) VALUES (900001,'Fixture bank','1234567890')");
      for (const payment of extras.slice(0, 2)) {
        const bankId = 900000 + payment.sequence;
        await query(`INSERT INTO bank_transactions (id,bank_account_id,type,amount,transaction_at,description,counterparty,fingerprint)
          VALUES ($1,900001,'expense',$2,$3,'Payroll extra fixture','Partial fixture',$4)`,
          [bankId, payment.amount, payment.date, `fixture-payroll-extra-${payment.sequence}`]);
        const cash = (await query("SELECT * FROM cash_transactions WHERE source_key=$1", [`2026-08:1:${payment.sequence}`])).rows[0];
        const suggestions = await fetch(`${base}/bank-transactions/${bankId}/cash-suggestions`, { headers: { Cookie: cookie } });
        assert.equal(suggestions.status, 200, await suggestions.clone().text());
        assert.ok((await suggestions.json()).some((row: {id: number}) => row.id === cash.id));
        for (let repeat = 0; repeat < 2; repeat++) {
          const response = await fetch(`${base}/bank-transactions/${bankId}/link-cash`, {
            method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ cashTransactionId: cash.id }),
          });
          assert.equal(response.status, 200, await response.clone().text());
        }
        const linked = (await query("SELECT * FROM cash_transactions WHERE id=$1", [cash.id])).rows[0];
        assert.equal(linked.bank_transaction_id, bankId);
        assert.equal(linked.source_type, "payroll");
        assert.equal(linked.source_key, cash.source_key);
        assert.ok(linked.journal_entry_id);
      }
      assert.equal((await query("SELECT count(*)::int AS n FROM journal_entries WHERE status='posted'")).rows[0].n, 2);
      assert.equal((await query("SELECT count(*)::int AS n FROM operating_expenses")).rows[0].n, 0);
      assert.equal((await save({ ...payload, additionalPayments: extras })).status, 200);
    });
    await t.test("cannot edit, remove through save, or delete bank-linked additional payments", async () => {
      for (const additionalPayments of [
        extras.map(payment => payment.sequence === 3 ? { ...payment, amount: 999 } : payment),
        extras.map(payment => payment.sequence === 3 ? { ...payment, date: "2026-09-09" } : payment),
        extras.filter(payment => payment.sequence !== 3),
      ]) {
        const response = await save({ ...payload, additionalPayments });
        assert.equal(response.status, 409, await response.clone().text());
      }
      assert.equal((await deletePayment(3)).status, 409);
      assert.deepEqual((await db.select().from(payrollAdjustmentsTable))[0].additionalPayments, extras);
    });
    await t.test("closed cash dates block both changing and deleting an unlinked extra payment", async () => {
      await query("INSERT INTO cash_closures(date) VALUES ('2026-09-08')");
      assert.equal((await deletePayment(7)).status, 409);
      assert.equal((await save({ ...payload, additionalPayments: extras.slice(0, 2) })).status, 409);
      await query("DELETE FROM cash_closures");
    });
    await t.test("deletes only the requested extra slot; higher-numbered links remain stable", async () => {
      assert.equal((await deletePayment(7)).status, 204);
      assert.equal((await deletePayment(7)).status, 404);
      const [adjustment] = await db.select().from(payrollAdjustmentsTable);
      assert.deepEqual(adjustment.additionalPayments, extras.slice(0, 2));
      assert.equal((await query("SELECT count(*)::int AS n FROM cash_transactions WHERE source_key='2026-08:1:7'")).rows[0].n, 0);
      const linked = (await query("SELECT * FROM cash_transactions WHERE source_key='2026-08:1:4'")).rows[0];
      assert.equal(linked.bank_transaction_id, 900004);
      assert.ok(linked.journal_entry_id);
    });
    await t.test("migration preserves legacy payments and rollback refuses to discard saved extras", async () => {
      const migration = new URL("../../../../lib/db/migrations/20261023_payroll_additional_payments.sql", import.meta.url);
      const rollback = new URL("../../../../lib/db/migrations/20261023_payroll_additional_payments.rollback.sql", import.meta.url);
      const table = `${schema}.migration_adjustments`;
      await query(`CREATE TABLE ${table} (id integer, paid_amount numeric, second_paid_amount numeric)`);
      await query(`INSERT INTO ${table} VALUES (1,700000,250000.25)`);
      await query((await readFile(migration, "utf8")).replaceAll("public.payroll_adjustments", table));
      const original = (await query(`SELECT * FROM ${table}`)).rows[0];
      assert.equal(Number(original.paid_amount), 700000);
      assert.equal(Number(original.second_paid_amount), 250000.25);
      assert.deepEqual(original.additional_payments, []);
      const reverse = (await readFile(rollback, "utf8")).replaceAll("public.payroll_adjustments", table);
      await query(`UPDATE ${table} SET additional_payments=$1`, [JSON.stringify(extras)]);
      await assert.rejects(query(reverse), /Additional payroll payments exist/);
      assert.deepEqual((await query(`SELECT additional_payments FROM ${table}`)).rows[0].additional_payments, extras);
      await query(`UPDATE ${table} SET additional_payments='[]'`);
      await query(reverse);
      assert.equal(Number((await query(`SELECT second_paid_amount FROM ${table}`)).rows[0].second_paid_amount), 250000.25);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    t.mock.restoreAll();
    await query("SET search_path TO public");
    await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
  }
});
