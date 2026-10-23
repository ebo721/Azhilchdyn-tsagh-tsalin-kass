import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { after, it } from "node:test";
import { db, pool, payrollAdjustmentsTable, usersTable } from "@workspace/db";
import app from "../app.js";
import { applyPayrollFinancials } from "./payroll-calc-helpers.js";
import { createStaffSession, hrCookie } from "./hr-session.js";
import { readPayrollPayables } from "./payroll-payables.js";

after(() => pool.end());

it("partial second payment preserves a bank-verified first payment despite another employee's matching bank cash", async (t) => {
  const schema = `payroll_partial_test_${Date.now()}`;
  const originalConnect = pool.connect.bind(pool);
  const client = await pool.connect();
  const query = client.query.bind(client);
  const server = app.listen(0);
  try {
    await query(`CREATE SCHEMA ${schema}`);
    for (const table of ["users", "employees", "payroll_adjustments", "cash_closures", "cash_transactions", "chart_of_accounts",
      "bank_accounts", "bank_transactions", "bank_internal_transfers", "journal_entries", "journal_lines", "operating_expenses",
      "receivables", "receivable_allocations", "payables", "payable_allocations", "payroll_attendance_snapshots",
      "payroll_opening_balances", "payroll_month_closures", "payroll_month_balances", "payroll_advance_approvals", "payroll_schedule_settings"]) {
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
    const bankPayment = (bankId: number, employeeId = 2, month = "2026-10") => fetch(`${base}/bank-transactions/${bankId}/link-payroll`, {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ employeeId, month }),
    });
    const computed = {
      month: "2026-10", periodStart: "2026-10-01", advancePeriodEnd: "2026-10-15", periodEnd: "2026-10-31",
      advancePaymentDate: "2026-10-15", finalPaymentDate: "2026-10-31",
      schedule: { id: 1, effectiveFromMonth: "2024-01", periodStartDay: 1, advanceCutoffDay: 15, periodEndDay: 31, advancePayDay: 15, finalPayDay: 31 },
      totalGross: 1000, totalSocialInsurance: 0, totalIncomeTax: 0, totalDeductions: 0, totalNet: 1000,
      lines: [{ employeeId: 2, employeeName: "Direct payroll fixture", employeeType: "shift", role: "Fixture",
        daysWorked: 10, hours: 80, gross: 1000, socialInsuranceSalary: 0, socialInsurance: 0, taxableIncome: 1000,
        calculatedIncomeTax: 0, taxRelief: 0, incomeTax: 0, advanceAmount: 0, manualDeduction: 0,
        receivableId: null, deductions: 0, carryoverAmount: 0, payable: 1000, paidAmount: 0,
        paymentDate: null, secondPaidAmount: 0, secondPaymentDate: null,
        remainingAmount: 1000, overpaidAmount: 0, balanceAmount: 1000, net: 1000 }],
    };
    await t.test("a smaller bank payment records salary once and leaves live salary debt without generic payables", async () => {
      await query(`INSERT INTO employees (id,name,role,employee_type,salary_type,base_salary,joined_at)
        VALUES (2,'Direct payroll fixture','Fixture','shift','daily',100,'2026-01-01')`);
      await query("INSERT INTO payroll_attendance_snapshots(month,payroll,advance) VALUES ('2026-10',$1,'{}')", [JSON.stringify(computed)]);
      for (const [id, amount] of [[900101, 300], [900102, 200], [900103, 500], [900104, 501], [900105, 300]]) {
        await query(`INSERT INTO bank_transactions(id,bank_account_id,type,amount,transaction_at,description,counterparty,fingerprint)
          VALUES ($1,900001,'expense',$2,'2026-10-23','Direct salary fixture','Direct payroll fixture',$3)`,
        [id, amount, `direct-salary-${id}`]);
      }
      const targets = await fetch(`${base}/bank-transactions/900101/payroll-targets/2026-10`, { headers: { Cookie: cookie } });
      assert.equal(targets.status, 200, await targets.clone().text());
      assert.equal((await targets.json()).find((row: {employeeId: number}) => row.employeeId === 2).remainingBalance, 1000);
      for (let repeat = 0; repeat < 2; repeat++) {
        const response = await bankPayment(900101);
        assert.equal(response.status, 200, await response.clone().text());
        const result = await response.json();
        assert.equal(result.paidAmount, 300);
        assert.equal(result.remainingBalance, 700);
      }
      const debt = await db.transaction(tx => readPayrollPayables(tx, "2026-10"));
      assert.equal(debt.lines.find(row => row.employeeId === 2)?.remainingBalance, 700);
      assert.equal((await query("SELECT count(*)::int AS n FROM cash_transactions WHERE source_key='2026-10:2'")).rows[0].n, 1);
      assert.equal((await query("SELECT count(*)::int AS n FROM payables")).rows[0].n, 0);
      assert.equal((await bankPayment(900101, 1)).status, 409);
    });
    await t.test("later bank payments reduce and close exactly that saved salary debt; overpayment is atomic", async () => {
      const second = await bankPayment(900102);
      assert.equal(second.status, 200, await second.clone().text());
      assert.equal((await second.json()).remainingBalance, 500);
      assert.equal((await bankPayment(900104)).status, 409);
      assert.equal((await query("SELECT cash_transaction_id FROM bank_transactions WHERE id=900104")).rows[0].cash_transaction_id, null);
      const third = await bankPayment(900103);
      assert.equal(third.status, 200, await third.clone().text());
      const result = await third.json();
      assert.equal(result.paidAmount, 1000);
      assert.equal(result.remainingBalance, 0);
      const debt = await db.transaction(tx => readPayrollPayables(tx, "2026-10"));
      assert.equal(debt.lines.some(row => row.employeeId === 2), false);
      assert.equal((await query("SELECT count(*)::int AS n FROM cash_transactions WHERE source_key LIKE '2026-10:2%'")).rows[0].n, 3);
      assert.equal((await bankPayment(900105)).status, 409);
      const posted = (await query("SELECT count(*)::int AS n FROM journal_entries WHERE source_type='bank_transaction' AND source_id IN (900101,900102,900103) AND status='posted'")).rows[0].n;
      assert.equal(posted, 3);
    });
    await t.test("a posting failure rolls back the salary payment, cash mirror and bank claim together", async () => {
      const changed = structuredClone(computed);
      changed.totalGross = changed.totalNet = 1100;
      changed.lines[0].gross = changed.lines[0].payable = changed.lines[0].net = 1100;
      await query("UPDATE payroll_attendance_snapshots SET payroll=$1 WHERE month='2026-10'", [JSON.stringify(changed)]);
      await query(`INSERT INTO bank_transactions(id,bank_account_id,type,amount,transaction_at,description,counterparty,fingerprint)
        VALUES (900106,900001,'expense',50,'2026-10-23','Rollback fixture','Direct payroll fixture','rollback-salary-900106')`);
      await query("UPDATE chart_of_accounts SET is_active=false WHERE code='1010'");
      try {
        const response = await bankPayment(900106);
        assert.equal(response.status, 409, await response.clone().text());
        assert.equal((await query("SELECT cash_transaction_id FROM bank_transactions WHERE id=900106")).rows[0].cash_transaction_id, null);
        assert.equal((await query("SELECT count(*)::int AS n FROM cash_transactions WHERE source_key LIKE '2026-10:2%'")).rows[0].n, 3);
        assert.equal((await query("SELECT additional_payments FROM payroll_adjustments WHERE month='2026-10' AND employee_id=2")).rows[0].additional_payments.length, 1);
      } finally {
        await query("UPDATE chart_of_accounts SET is_active=true WHERE code='1010'");
        await query("UPDATE payroll_attendance_snapshots SET payroll=$1 WHERE month='2026-10'", [JSON.stringify(computed)]);
      }
    });
    await t.test("bank payment reuses a matching pre-recorded salary payment rather than paying twice", async () => {
      // First unlink, keeping the recorded salary payment as the existing cash lifecycle does.
      await query("UPDATE bank_transactions SET cash_transaction_id=null,journal_entry_id=null,transferred_at=null WHERE id=900101");
      await query("UPDATE cash_transactions SET bank_transaction_id=null,bank_verified_at=null WHERE source_key='2026-10:2'");
      const response = await bankPayment(900105);
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json();
      assert.equal(result.reusedPayment, true);
      assert.equal(result.paidAmount, 1000);
      assert.equal(result.remainingBalance, 0);
      assert.equal((await query("SELECT count(*)::int AS n FROM cash_transactions WHERE source_key LIKE '2026-10:2%'")).rows[0].n, 3);
      assert.equal((await bankPayment(900104, 2, "2026-09")).status, 409);
    });
    await t.test("bank advances retain each installment and deduct only actual payments from final payroll", async () => {
      const month = "2026-11";
      const advancePayroll = { ...computed, month, periodStart: `${month}-01`, periodEnd: `${month}-30`,
        advancePeriodEnd: `${month}-15`, advancePaymentDate: `${month}-15`, finalPaymentDate: `${month}-30` };
      await query("INSERT INTO payroll_attendance_snapshots(month,payroll,advance) VALUES ($1,$2,'{}')", [month, JSON.stringify(advancePayroll)]);
      const line = { employeeId: 2, employeeName: "Advance fixture", employeeType: "shift", baseSalary: 100,
        daysWorked: 10, dailySalary: 100, totalSalary: 1000, advanceAmount: 1000, paid: false, paymentDate: null };
      await query("INSERT INTO payroll_advance_approvals(month,approval_date,total_amount,lines) VALUES ($1,$2,1150,$3)",
        [month, `${month}-15`, JSON.stringify([line, { ...line, employeeId: 1, advanceAmount: 150, paid: true, paymentDate: `${month}-12` }])]);
      for (const [id, amount] of [[900201, 300], [900202, 200], [900203, 500], [900204, 501], [900205, 150], [900206, 300]]) {
        await query(`INSERT INTO bank_transactions(id,bank_account_id,type,amount,transaction_at,description,counterparty,fingerprint)
          VALUES ($1,900001,'expense',$2,$3,'Advance installment fixture','Advance fixture',$4)`,
          [id, amount, `${month}-15`, `advance-fixture-${id}`]);
      }
      const link = (id: number, employeeId = 2) => fetch(`${base}/bank-transactions/${id}/link-payroll`, {
        method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ month, employeeId, paymentKind: "advance" }),
      });
      const remove = (sequence: number) => fetch(`${base}/payroll-advance/${month}/2/transactions/${sequence}`, {
        method: "DELETE", headers: { Cookie: cookie },
      });
      const targets = await fetch(`${base}/bank-transactions/900201/advance-targets/${month}`, { headers: { Cookie: cookie } });
      assert.equal(targets.status, 200, await targets.clone().text());
      assert.equal((await targets.json())[0].remainingBalance, 1000);
      for (const [id, paid, remaining] of [[900201, 300, 700], [900202, 500, 500], [900203, 1000, 0]]) {
        const response = await link(id);
        assert.equal(response.status, 200, await response.clone().text());
        const result = await response.json();
        assert.equal(result.paidAmount, paid);
        assert.equal(result.remainingBalance, remaining);
        const summary = await fetch(`${base}/payroll?month=${month}`, { headers: { Cookie: cookie } });
        assert.equal(summary.status, 200, await summary.clone().text());
        const employee = (await summary.json()).lines.find((row: {employeeId: number}) => row.employeeId === 2);
        assert.equal(employee.advanceAmount, paid);
        assert.equal(employee.payable, 1000 - paid);
        if (id === 900202) {
          assert.equal((await link(900204)).status, 409, "Overpayment is rejected");
          assert.equal((await remove(1)).status, 409, "Linked installment cannot be deleted");
          assert.equal((await fetch(`${base}/payroll-advance/approval?month=${month}`, { method: "DELETE", headers: { Cookie: cookie } })).status, 409);
        }
      }
      assert.equal((await link(900201)).status, 200, "Idempotent retry");
      assert.equal((await link(900201, 1)).status, 409, "Cannot claim another employee's payment");
      const cashRows = (await query("SELECT * FROM cash_transactions WHERE source_type='payroll_advance' AND source_key LIKE '2026-11:2%' ORDER BY source_key")).rows;
      assert.deepEqual(cashRows.map(row => row.source_key), ["2026-11:2", "2026-11:2:2", "2026-11:2:3"]);
      assert.ok(cashRows.every(row => row.bank_transaction_id && row.journal_entry_id));
      const legacyEdit = await fetch(`${base}/payroll-advance/payment`, { method: "PUT",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ month, employeeId: 2, advanceAmount: 1000, paid: false }) });
      assert.equal(legacyEdit.status, 409, "Old clients cannot erase installments");
      assert.equal((await query("SELECT count(*)::int n FROM payables")).rows[0].n, 0);

      // Unlink is not cancellation: the original payment survives, and can be reused.
      const unlink = await fetch(`${base}/bank-transactions/900201/unlink-cash`, { method: "POST", headers: { Cookie: cookie } });
      assert.equal(unlink.status, 200, await unlink.clone().text());
      const reuse = await link(900206);
      assert.equal(reuse.status, 200, await reuse.clone().text());
      assert.equal((await reuse.json()).reusedPayment, true);
      assert.equal((await query("SELECT id FROM cash_transactions WHERE source_key='2026-11:2' AND source_type='payroll_advance'")).rows[0].id, cashRows[0].id);

      // A legacy full payment retains the unsuffixed key and journal when claimed.
      await query(`INSERT INTO cash_transactions(type,category,amount,date,description,source_type,source_key)
        VALUES ('expense','Урьдчилгаа цалин',150,'2026-11-12','Legacy advance','payroll_advance','2026-11:1')`);
      const legacy = await link(900205, 1);
      assert.equal(legacy.status, 200, await legacy.clone().text());
      assert.equal((await legacy.json()).reusedPayment, true);
      const oldLines = (await query("SELECT lines FROM payroll_advance_approvals WHERE month=$1", [month])).rows[0].lines;
      assert.equal(oldLines.find((row: {employeeId: number}) => row.employeeId === 1).payments, undefined);

      await fetch(`${base}/bank-transactions/900202/unlink-cash`, { method: "POST", headers: { Cookie: cookie } });
      await query("INSERT INTO cash_closures(date) VALUES ('2026-11-15')");
      assert.equal((await remove(2)).status, 409, "Closed date cannot be cancelled");
      assert.equal((await link(900202)).status, 409, "Closed date cannot be linked");
      await query("DELETE FROM cash_closures WHERE date='2026-11-15'");
      assert.equal((await remove(2)).status, 200);
      const remainingLines = (await query("SELECT lines FROM payroll_advance_approvals WHERE month=$1", [month])).rows[0].lines;
      const updated = remainingLines.find((row: {employeeId: number}) => row.employeeId === 2);
      assert.deepEqual(updated.payments.map((p: {sequence: number}) => p.sequence), [1, 3]);
      assert.equal(updated.paid, false);
      const readd = await link(900202);
      assert.equal(readd.status, 200, await readd.clone().text());
      assert.equal((await query("SELECT count(*)::int n FROM cash_transactions WHERE source_type='payroll_advance' AND source_key='2026-11:2:4'")).rows[0].n, 1);
      await query("INSERT INTO payroll_month_closures(month,payroll,advance,closed_by) VALUES ($1,$2,$3,1)", [month, JSON.stringify(advancePayroll), JSON.stringify({})]);
      assert.equal((await remove(4)).status, 409, "Closed month cannot be cancelled");
      assert.equal((await link(900204)).status, 409, "Closed month cannot receive payment");
      assert.equal((await fetch(`${base}/bank-transactions/900202/unlink-cash`, { method: "POST", headers: { Cookie: cookie } })).status, 409, "Closed month cannot unlink or void the advance journal");
      await query("DELETE FROM payroll_month_closures WHERE month=$1", [month]);
    });
    await t.test("concurrent advance transfers serialize and failed journal posting rolls back the entire settlement", async () => {
      const month = "2026-12";
      const line = { employeeId: 2, employeeName: "Concurrent advance", employeeType: "shift", baseSalary: 100,
        daysWorked: 10, dailySalary: 100, totalSalary: 1000, advanceAmount: 1000, paid: false };
      await query("INSERT INTO payroll_advance_approvals(month,approval_date,total_amount,lines) VALUES ($1,$2,1000,$3)",
        [month, `${month}-15`, JSON.stringify([line])]);
      for (const [id, amount] of [[900301, 400], [900302, 400], [900303, 300], [900304, 200]]) {
        await query(`INSERT INTO bank_transactions(id,bank_account_id,type,amount,transaction_at,description,counterparty,fingerprint)
          VALUES ($1,900001,'expense',$2,$3,'Concurrent advance','Advance fixture',$4)`,
          [id, amount, `${month}-15`, `advance-concurrent-${id}`]);
      }
      const link = (id: number) => fetch(`${base}/bank-transactions/${id}/link-payroll`, {
        method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ month, employeeId: 2, paymentKind: "advance" }),
      });
      // Real separate connections are required to exercise advisory/row locking.
      t.mock.method(pool, "connect", (async () => {
        const connection = await originalConnect();
        await connection.query(`SET search_path TO ${schema}`);
        return connection;
      }) as typeof pool.connect);
      try {
        const responses = await Promise.all([link(900301), link(900301), link(900302), link(900303)]);
        const statuses = responses.map(response => response.status);
        assert.equal(statuses.filter(status => status === 200).length, 3, statuses.join(","));
        assert.equal(statuses.filter(status => status === 409).length, 1, statuses.join(","));
        const saved = (await query("SELECT lines FROM payroll_advance_approvals WHERE month=$1", [month])).rows[0].lines[0];
        assert.equal(saved.payments.length, 2);
        assert.ok(saved.payments.reduce((sum: number, p: {amount: number}) => sum + p.amount, 0) <= 1000);
        assert.equal((await query("SELECT count(*)::int n FROM cash_transactions WHERE source_type='payroll_advance' AND source_key LIKE '2026-12:2%'")).rows[0].n, 2);
        // Exact rollback assertion: no new installment, cash, bank link, or journal.
        const journalCount = (await query("SELECT count(*)::int n FROM journal_entries")).rows[0].n;
        await query("UPDATE chart_of_accounts SET is_active=false WHERE code='1010'");
        const response = await link(900304);
        assert.equal(response.status, 409, await response.clone().text());
        assert.deepEqual((await query("SELECT lines FROM payroll_advance_approvals WHERE month=$1", [month])).rows[0].lines[0], saved);
        assert.equal((await query("SELECT cash_transaction_id FROM bank_transactions WHERE id=900304")).rows[0].cash_transaction_id, null);
        assert.equal((await query("SELECT count(*)::int n FROM journal_entries")).rows[0].n, journalCount);
      } finally {
        await query("UPDATE chart_of_accounts SET is_active=true WHERE code='1010'");
        t.mock.method(pool, "connect", (() => Promise.resolve({ query, release() {} } as unknown as typeof client)) as typeof pool.connect);
      }
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
