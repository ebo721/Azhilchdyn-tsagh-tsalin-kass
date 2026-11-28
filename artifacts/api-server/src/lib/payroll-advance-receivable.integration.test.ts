import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, it } from "node:test";
import { pool, usersTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app.js";
import { createStaffSession, hrCookie } from "./hr-session.js";
import { advanceSettledAmount, advanceFinancials } from "./payroll-advance-installments.js";

after(() => pool.end());

it("advance receivable API settles once, protects ownership/closures and pays only net cash", async t => {
  const schema = `advance_receivable_test_${Date.now()}`;
  const client = await pool.connect();
  const query = client.query.bind(client);
  const server = app.listen(0);
  const tables = ["users", "employees", "cash_closures", "cash_transactions", "chart_of_accounts",
    "bank_accounts", "bank_transactions", "bank_internal_transfers", "journal_entries", "journal_lines", "operating_expenses",
    "receivables", "receivable_allocations", "payables", "payable_allocations", "payroll_month_closures",
    "payroll_advance_approvals", "payroll_schedule_settings", "payroll_attendance_snapshots", "payroll_adjustments"];
  try {
    await query(`CREATE SCHEMA ${schema}`);
    for (const table of tables) await query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    await query(`SET search_path TO ${schema}`);
    t.mock.method(pool, "connect", (() => Promise.resolve({ query, release() {} } as unknown as typeof client)) as typeof pool.connect);
    t.mock.method(pool, "query", query as typeof pool.query);
    await query("INSERT INTO users(id,username,normalized_username,role,password_hash) VALUES (1,'advance-test','advance-test','admin','invalid')");
    await query("INSERT INTO employees(id,name,role,base_salary,joined_at) VALUES (1,'Advance fixture','test',1000,'2026-01-01'),(2,'Other fixture','test',1000,'2026-01-01')");
    await query(`INSERT INTO chart_of_accounts(code,name,type,normal_balance)
      VALUES ('1000','Cash','asset','debit'),('1200','Receivable','asset','debit'),
      ('2100','Payroll payable','liability','credit'),('1010','Bank','asset','debit'),('6000','Salary','expense','debit')`);
    const { postJournalEntry } = await import("./journal-posting.js");
    const accounts = (await query("SELECT id,code FROM chart_of_accounts")).rows;
    const account = (code: string) => accounts.find((a: {code: string}) => a.code === code).id as number;
    const origin = await db.transaction(tx => postJournalEntry(tx, {
      date: "2026-11-01", description: "Fixture employee debt", sourceType: "test", sourceId: null, createdBy: null,
      lines: [{ accountId: account("1200"), debit: 150000, credit: 0,
        allocation: { kind: "create", partyType: "employee", employeeId: 1 } },
      { accountId: account("1000"), debit: 0, credit: 150000 }],
    }));
    const receivableId = (await query("SELECT id FROM receivables WHERE origin_journal_entry_id=$1", [origin.journalEntryId])).rows[0].id;
    const line = { employeeId: 1, employeeName: "Advance fixture", employeeType: "office", baseSalary: 1000000,
      daysWorked: 10, dailySalary: 50000, totalSalary: 1000000, advanceAmount: 500000, paid: false };
    await query("INSERT INTO payroll_advance_approvals(month,approval_date,lines,total_amount) VALUES ('2026-11','2026-11-15',$1,500000)", [JSON.stringify([line])]);
    const [admin] = await db.select().from(usersTable).where(eq(usersTable.id, 1));
    const cookie = `${hrCookie.name}=${createStaffSession(admin)}`;
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const call = (path: string, data: unknown, method = "PUT", roleCookie = cookie) => fetch(`${base}${path}`, {
      method, headers: { Cookie: roleCookie, "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    const input = { month: "2026-11", employeeId: 1, receivableId, amount: 100000, date: "2026-11-15" };
    const deduct = (patch: Record<string, unknown> = {}) => call("/payroll-advance/receivable", { ...input, ...patch });
    const current = async () => (await query("SELECT lines FROM payroll_advance_approvals WHERE month='2026-11'")).rows[0].lines[0];
    const open = async () => Number((await query("SELECT open_amount FROM receivables WHERE id=$1", [receivableId])).rows[0].open_amount);
    assert.equal((await deduct({ employeeId: 2 })).status, 404);
    await query("UPDATE receivables SET employee_id=2 WHERE id=$1", [receivableId]);
    assert.equal((await deduct()).status, 409);
    await query("UPDATE receivables SET employee_id=1 WHERE id=$1", [receivableId]);
    assert.equal((await deduct({ amount: 200000 })).status, 409, "Cannot settle more than open debt");
    assert.equal(await open(), 150000);
    assert.equal((await deduct({ amount: 500001 })).status, 400);
    assert.equal((await deduct({ date: '2026-02-30' })).status, 400);
    const response = await deduct();
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(await open(), 50000);
    assert.equal(advanceFinancials(await current()).remainingBalance, 400000);
    assert.equal(advanceSettledAmount(await current()), 100000);
    const journalId = (await current()).receivableJournalEntryId;
    assert.equal((await deduct()).status, 200);
    assert.equal((await current()).receivableJournalEntryId, journalId, "Retry reuses journal");
    assert.equal((await deduct({ amount: 200000 })).status, 409);
    assert.equal((await current()).receivableJournalEntryId, journalId, "Failed replacement keeps original settlement");
    assert.equal(await open(), 50000, "Failed replacement rolls back the reversal");
    assert.equal((await call(`/journal/entries/${journalId}/void`, {}, "POST")).status, 409);
    await query("INSERT INTO cash_closures(date) VALUES ('2026-11-15')");
    assert.equal((await deduct({ amount: 80000 })).status, 409);
    await query("DELETE FROM cash_closures");
    assert.equal((await deduct({ amount: 80000 })).status, 200);
    assert.equal(await open(), 70000);
    assert.equal((await deduct({ amount: 100000 })).status, 200);
    const paid = await call("/payroll-advance/payment", { month: "2026-11", employeeId: 1, advanceAmount: 500000, paid: true, paymentDate: "2026-11-15" });
    assert.equal(paid.status, 200, await paid.clone().text());
    assert.equal(Number((await query("SELECT amount FROM cash_transactions WHERE source_type='payroll_advance'")).rows[0].amount), 400000);
    assert.equal(advanceSettledAmount(await current()), 500000, "Final payroll deducts exactly gross advance once");
    assert.equal((await deduct({ amount: 90000 })).status, 409, "Paid advance cannot silently change net");
    assert.equal((await call("/payroll-advance/payment", { month: "2026-11", employeeId: 1, advanceAmount: 500000, paid: false })).status, 200);
    assert.equal(await open(), 50000, "Cancelling cash does not also reverse receivable");
    assert.equal((await deduct({ receivableId: null, amount: 0 })).status, 200);
    assert.equal(await open(), 150000);
    assert.equal(advanceSettledAmount(await current()), 0);
    assert.equal((await query("SELECT count(*)::int n FROM cash_transactions WHERE source_type='payroll_advance'")).rows[0].n, 0);
    await query("INSERT INTO payroll_month_closures(month,payroll,advance,closed_by) VALUES ('2026-11','{}','{}',1)");
    assert.equal((await deduct()).status, 409, "Closed payroll month blocks deductions");
    await query("DELETE FROM payroll_month_closures");
    await query("INSERT INTO users(id,username,normalized_username,role,password_hash) VALUES (2,'advance-hr','advance-hr','hr','invalid')");
    const [hr] = await db.select().from(usersTable).where(eq(usersTable.id, 2));
    assert.equal((await call("/payroll-advance/receivable", input, "PUT", `${hrCookie.name}=${createStaffSession(hr)}`)).status, 403);
    await query(`UPDATE payroll_advance_approvals SET lines=jsonb_set(lines,'{0,advanceAmount}','150000') WHERE month='2026-11'`);
    assert.equal((await deduct({ amount: 150000 })).status, 200);
    assert.equal(await open(), 0);
    assert.equal(advanceFinancials(await current()).remainingBalance, 0);
    assert.equal(advanceSettledAmount(await current()), 150000);
    assert.equal((await query("SELECT count(*)::int n FROM cash_transactions")).rows[0].n, 0, "Full deduction creates no cash payment");
    assert.equal((await deduct({ amount: 0, receivableId: null })).status, 200);
    await query(`UPDATE payroll_advance_approvals SET lines=jsonb_set(lines,'{0,advanceAmount}','500000') WHERE month='2026-11'`);
    assert.equal((await deduct()).status, 200);
    await query("INSERT INTO bank_accounts(id,bank_name,account_number) VALUES (1,'Fixture bank','fixture-account')");
    for (const [id, amount] of [[1, 250000], [2, 150000], [3, 1]]) {
      await query(`INSERT INTO bank_transactions(id,bank_account_id,type,amount,transaction_at,description,counterparty,fingerprint)
        VALUES ($1,1,'expense',$2,'2026-11-15','Fixture advance','Fixture',$3)`, [id, amount, `advance-debt-${id}`]);
    }
    const targets = await fetch(`${base}/bank-transactions/1/advance-targets/2026-11`, { headers: { Cookie: cookie } });
    assert.equal(targets.status, 200, await targets.clone().text());
    assert.equal((await targets.json())[0].remainingBalance, 400000);
    for (const [id, paidAmount, remainingBalance] of [[1, 250000, 150000], [2, 400000, 0]]) {
      const response = await call(`/bank-transactions/${id}/link-payroll`, { month: "2026-11", employeeId: 1, paymentKind: "advance" }, "POST");
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json();
      assert.equal(result.paidAmount, paidAmount);
      assert.equal(result.remainingBalance, remainingBalance);
    }
    assert.equal((await current()).paid, true);
    assert.equal(await open(), 50000, "Bank installments do not settle the receivable again");
    assert.equal(advanceSettledAmount(await current()), 500000);
    assert.equal(Number((await query("SELECT sum(amount) amount FROM cash_transactions WHERE source_type='payroll_advance'")).rows[0].amount), 400000);
    assert.equal((await call("/bank-transactions/3/link-payroll", { month: "2026-11", employeeId: 1, paymentKind: "advance" }, "POST")).status, 409);

    // Insert the newer debt first: FIFO must use the document date, not its ID.
    for (const [date, amount] of [["2026-11-10", 150000], ["2026-11-01", 250000]] as const) {
      await db.transaction(tx => postJournalEntry(tx, {
        date, description: "Aggregate fixture debt", sourceType: "test", sourceId: null, createdBy: null,
        lines: [{ accountId: account("1200"), debit: amount, credit: 0,
          allocation: { kind: "create", partyType: "employee", employeeId: 2 } },
        { accountId: account("1000"), debit: 0, credit: amount }],
      }));
    }
    const balances = async () => (await query("SELECT open_amount::numeric::float8 amount FROM receivables WHERE employee_id=2 ORDER BY original_amount DESC")).rows.map(row => row.amount);
    const monthly = (manualDeduction: number, settleReceivables = true) => call("/payroll-adjustments", {
      month: "2026-12", employeeId: 2, manualDeduction, settleReceivables, receivableId: null,
      paidAmount: 0, secondPaidAmount: 0, paymentDate: null, secondPaymentDate: null,
    });
    const adjustment = async () => (await query("SELECT * FROM payroll_adjustments WHERE employee_id=2 AND month='2026-12'")).rows[0];
    let settled = await monthly(300000);
    assert.equal(settled.status, 200, await settled.clone().text());
    assert.deepEqual(await balances(), [0, 100000], "Aggregate salary settles oldest then partially newer debt");
    const monthlyJournal = (await adjustment()).journal_entry_id;
    assert.equal((await monthly(300000)).status, 200);
    assert.equal((await adjustment()).journal_entry_id, monthlyJournal, "Retry must preserve all allocations, including fully settled oldest debt");
    const settlementDate = (await query("SELECT date::text date FROM journal_entries WHERE id=$1", [monthlyJournal])).rows[0].date;
    await query("INSERT INTO cash_closures(date) VALUES ($1)", [settlementDate]);
    assert.equal((await monthly(200000)).status, 409, "Noncash deductions respect cash-date closure too");
    await query("DELETE FROM cash_closures");
    assert.equal((await monthly(450000)).status, 409);
    assert.deepEqual(await balances(), [0, 100000], "Rejected salary edit rolls back every allocation");
    assert.equal((await adjustment()).journal_entry_id, monthlyJournal);
    assert.equal((await monthly(200000)).status, 200);
    assert.deepEqual(await balances(), [50000, 150000], "Smaller deduction restores both debts before allocating");
    assert.equal((await monthly(0)).status, 200);
    assert.deepEqual(await balances(), [250000, 150000], "Zero salary deduction restores the whole settlement");
    assert.equal((await monthly(400000)).status, 200);
    assert.deepEqual(await balances(), [0, 0], "Entire balance may be settled without a cash payout");
    assert.equal((await monthly(0, false)).status, 200);
    assert.deepEqual(await balances(), [250000, 150000]);
    assert.equal((await monthly(12345, false)).status, 200);
    assert.deepEqual(await balances(), [250000, 150000], "Ordinary manual deductions must remain distinct from registered debt");

    await query("INSERT INTO payroll_advance_approvals(month,approval_date,lines,total_amount) VALUES ('2026-12','2026-12-15',$1,500000)", [JSON.stringify([{ ...line, employeeId: 2 }])]);
    const automaticAdvance = (amount: number) => call("/payroll-advance/receivable", {
      month: "2026-12", employeeId: 2, amount, date: "2026-12-15",
    });
    const aggregateLine = async () => (await query("SELECT lines FROM payroll_advance_approvals WHERE month='2026-12'")).rows[0].lines[0];
    settled = await automaticAdvance(300000);
    assert.equal(settled.status, 200, await settled.clone().text());
    assert.deepEqual(await balances(), [0, 100000]);
    const advanceJournal = (await aggregateLine()).receivableJournalEntryId;
    assert.equal((await automaticAdvance(300000)).status, 200);
    assert.equal((await aggregateLine()).receivableJournalEntryId, advanceJournal);
    await query("INSERT INTO cash_closures(date) VALUES ('2026-12-15')");
    assert.equal((await automaticAdvance(200000)).status, 409);
    await query("DELETE FROM cash_closures");
    assert.equal((await automaticAdvance(400001)).status, 409);
    assert.deepEqual(await balances(), [0, 100000]);
    assert.equal((await aggregateLine()).receivableJournalEntryId, advanceJournal);
    assert.equal((await automaticAdvance(200000)).status, 200);
    assert.deepEqual(await balances(), [50000, 150000]);
    assert.equal((await automaticAdvance(0)).status, 200);
    assert.deepEqual(await balances(), [250000, 150000]);
    assert.equal((await automaticAdvance(400000)).status, 200);
    assert.deepEqual(await balances(), [0, 0]);
    assert.equal(advanceFinancials(await aggregateLine()).remainingBalance, 100000);
    assert.equal((await automaticAdvance(0)).status, 200);
    assert.deepEqual(await balances(), [250000, 150000]);
    assert.equal((await query("SELECT count(*)::int n FROM cash_transactions WHERE source_key='2026-12:2' OR source_key LIKE '2026-12:2:%'")).rows[0].n, 0,
      "Noncash settlements never create fictitious cash payments");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    t.mock.restoreAll();
    await query("SET search_path TO public");
    await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
  }
});
