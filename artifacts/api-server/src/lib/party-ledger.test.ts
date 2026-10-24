import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import app from "../app.js";
import { ledgerConclusion, readPartyLedger } from "./party-ledger.js";
import { createStaffSession, hrCookie } from "./hr-session.js";
import { usersTable } from "@workspace/db";

test("party ledger sign and cent rounding", () => {
  assert.equal(ledgerConclusion(10), "receivable");
  assert.equal(ledgerConclusion(-10), "payable");
  assert.equal(ledgerConclusion(0.001), "balanced");
  assert.equal(ledgerConclusion(0), "balanced");
});

test("read-only party ledger source ownership, reversals and authorization", { timeout: 120000 }, async t => {
  const client = await pool.connect();
  const schema = `party_ledger_${Date.now()}`;
  const query = client.query.bind(client);
  const server = app.listen(0);
  try {
    await query(`CREATE SCHEMA "${schema}"`);
    for (const name of ["users", "employees", "inventory_suppliers", "chart_of_accounts", "journal_entries",
      "journal_lines", "receivables", "receivable_allocations", "payables", "payable_allocations",
      "cash_transactions", "bank_transactions", "payroll_adjustments", "payroll_attendance_snapshots",
      "payroll_opening_balances", "payroll_month_closures", "payroll_month_balances", "payroll_advance_approvals",
      "payroll_schedule_settings"]) {
      await query(`CREATE TABLE "${schema}"."${name}" (LIKE public."${name}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    }
    await query(`SET search_path TO "${schema}", public`);
    mock.method(pool, "connect", async () => ({ query, release() {} }));
    mock.method(pool, "query", query as typeof pool.query);
    await query(`INSERT INTO users(id,username,normalized_username,password_hash,role,menu_paths) VALUES
      (1,'ledger-admin','ledger-admin','unused','admin',NULL),
      (2,'ledger-accountant','ledger-accountant','unused','accountant','{"/ar-ap"}'),
      (3,'ledger-warehouse','ledger-warehouse','unused','warehouse',NULL),
      (4,'ledger-viewer','ledger-viewer','unused','viewer',NULL),
      (5,'ledger-hr','ledger-hr','unused','hr',NULL),
      (6,'ledger-denied','ledger-denied','unused','accountant','{"/cash"}')`);
    await query(`INSERT INTO employees(id,name,role,base_salary,bank_account_number,joined_at) VALUES
      (1,'Ledger employee','Fixture',1000,'MN 11-1234','2026-01-01'),
      (2,'Other employee','Fixture',1000,'OTHER','2026-01-01')`);
    await query(`INSERT INTO inventory_suppliers(id,name,normalized_name) VALUES(1,'Ledger supplier','ledger supplier')`);
    await query(`INSERT INTO chart_of_accounts(id,code,name,type,normal_balance) VALUES
      (1,'1200','Receivable','asset','debit'),(2,'2000','Payable','liability','credit'),
      (3,'6000','Expense','expense','debit'),(4,'1010','Bank','asset','debit'),(5,'1500','Stock','asset','debit')`);
    await query(`INSERT INTO journal_entries(id,date,description,source_type,source_id,status,voided_at) VALUES
      (1,'2026-01-01','Opening debt','employee_receivable',1,'posted',NULL),
      (2,'2026-02-10','Debt repayment','bank_transaction',1,'posted',NULL),
      (3,'2026-02-02','Manual not attributable','manual',1,'posted',NULL),
      (4,'2026-02-03','Voided debt','employee_receivable',1,'void',now()),
      (5,'2026-02-03','Voided compensation','reversal',4,'posted',NULL),
      (6,'2026-02-05','Salary payment','cash',1,'posted',NULL),
      (7,'2026-02-06','Supplier debt','payable',1,'posted',NULL),
      (8,'2026-02-07','Supplier settlement','bank_transaction',7,'posted',NULL),
      (9,'2026-02-08','Ledger supplier purchase without supplier ID','inventory_purchase',1,'posted',NULL),
      (10,'2026-02-08','Two employees','employee_receivable',NULL,'posted',NULL),
      (11,'2026-02-08','Draft debt','employee_receivable',1,'draft',NULL)`);
    await query(`INSERT INTO journal_lines(id,journal_entry_id,account_id,debit,credit,allocation) VALUES
      (1,1,1,100,0,NULL),(2,1,3,0,100,NULL),
      (3,2,4,40,0,NULL),(4,2,1,0,40,NULL),
      (5,3,1,999,0,NULL),(6,3,3,0,999,NULL),
      (7,4,1,500,0,NULL),(8,4,3,0,500,NULL),
      (9,5,1,0,500,NULL),(10,5,3,500,0,NULL),
      (11,6,3,300,0,NULL),(12,6,4,0,300,NULL),
      (13,7,3,200,0,NULL),(14,7,2,0,200,'{"kind":"create","partyType":"supplier","supplierId":1}'),
      (15,8,2,50,0,NULL),(16,8,4,0,50,NULL),
      (17,9,5,70,0,NULL),(18,9,4,0,70,NULL),
      (19,10,1,20,0,'{"kind":"create","partyType":"employee","employeeId":1}'),
      (20,10,1,30,0,'{"kind":"create","partyType":"employee","employeeId":2}'),(21,10,3,0,50,NULL),
      (22,11,1,555,0,NULL),(23,11,3,0,555,NULL)`);
    await query(`INSERT INTO receivables(id,origin_journal_entry_id,origin_journal_line_id,employee_id,original_amount,open_amount) VALUES
      (1,1,1,1,100,60),(2,4,7,1,500,500),(3,10,19,1,20,20),(4,10,20,2,30,30)`);
    await query(`INSERT INTO receivable_allocations(receivable_id,settlement_journal_entry_id,settlement_journal_line_id,amount) VALUES(1,2,4,40)`);
    await query(`INSERT INTO payables(id,party_type,party_id,original_amount,remaining_balance,journal_entry_id,description)
      VALUES(1,'supplier',1,200,150,7,'Supplier debt')`);
    await query(`INSERT INTO payable_allocations(payable_id,settlement_journal_entry_id,settlement_journal_line_id,amount) VALUES(1,8,15,50)`);
    await query(`INSERT INTO payroll_adjustments(employee_id,month,paid_amount,payment_date) VALUES(1,'2026-02',300,'2026-02-05')`);
    await query(`INSERT INTO cash_transactions(id,type,category,description,amount,date,source_type,source_key,bank_transaction_id,journal_entry_id)
      VALUES(1,'expense','Цалин','Salary',300,'2026-02-05','payroll','2026-02:1',2,6)`);
    await query(`INSERT INTO bank_transactions(id,type,amount,transaction_at,account,description,fingerprint,journal_entry_id,cash_transaction_id) VALUES
      (1,'income',40,'2026-02-10','MN111234','Debt repayment','ledger-1',2,NULL),
      (2,'expense',300,'2026-02-05','MN111234','Salary','ledger-2',6,1),
      (3,'expense',25,'2026-02-28 23:59:59+00','MN-11 1234','Unmatched','ledger-3',NULL,NULL),
      (4,'expense',11,'2026-02-10','MN111234','Already linked','ledger-4',6,NULL),
      (5,'expense',20,'2026-03-01','MN111234','Outside range','ledger-5',NULL,NULL),
      (6,'expense',20,'2026-02-10','','Missing account','ledger-6',NULL,NULL),
      (7,'expense',50,'2026-02-07','Vendor','Supplier repayment','ledger-7',8,NULL)`);
    const input = { partyType: "employee" as const, partyId: 1, from: "2026-02-01", to: "2026-02-28" };
    await t.test("opening SUM, exact line attribution, salary as information, and void/reversal pair exclusion", async () => {
      const result = await readPartyLedger(input);
      assert.equal(result.openingBalance, 100);
      assert.equal(result.totalDebit, 20);
      assert.equal(result.totalCredit, 40);
      assert.equal(result.closingBalance, 80);
      assert.equal(result.conclusion, "receivable");
      assert.deepEqual([...new Set(result.lines.map(l => l.journalEntryId))].sort((a,b) => a-b), [2,6,10]);
      assert.ok(result.lines.filter(l => l.journalEntryId === 6).every(l => !l.affectsBalance));
      assert.equal(result.lines.find(l => l.id === 4)?.balance, 80);
      assert.deepEqual(result.unmatchedBankTransactions.map(row => row.id), [3]);
      assert.equal(result.payroll?.available, false);
      const other = await readPartyLedger({ ...input, partyId: 2 });
      assert.equal(other.closingBalance, 30);
      assert.equal(other.lines.some(row => row.id === 19), false);
    });
    await t.test("supplier debt and payment resolve from allocation IDs, not purchase descriptions or custodians", async () => {
      const result = await readPartyLedger({ ...input, partyType: "supplier" });
      assert.equal(result.closingBalance, -150);
      assert.equal(result.conclusion, "payable");
      assert.equal(result.totalDebit, 50);
      assert.equal(result.totalCredit, 200);
      assert.deepEqual([...new Set(result.lines.map(l => l.journalEntryId))], [7,8]);
      assert.equal(result.payroll, null);
      assert.deepEqual(result.unmatchedBankTransactions, []);
      assert.ok(result.warnings.some(s => s.includes("supplierId")));
    });
    await t.test("saved employee payroll is separate from the ledger and reports its sign-normalized difference", async () => {
      const saved = {
        month: "2026-02", periodStart: "2026-02-01", advancePeriodEnd: "2026-02-15", periodEnd: "2026-02-28",
        advancePaymentDate: "2026-02-15", finalPaymentDate: "2026-02-28",
        schedule: { id: 1, effectiveFromMonth: "2024-01", periodStartDay: 1, advanceCutoffDay: 15, periodEndDay: 31, advancePayDay: 15, finalPayDay: 31 },
        totalGross: 1000, totalSocialInsurance: 0, totalIncomeTax: 0, totalDeductions: 0, totalNet: 1000,
        lines: [{ employeeId: 1, employeeName: "Ledger employee", employeeType: "shift", role: "Fixture",
          daysWorked: 10, hours: 80, gross: 1000, socialInsuranceSalary: 0, socialInsurance: 0, taxableIncome: 1000,
          calculatedIncomeTax: 0, taxRelief: 0, incomeTax: 0, advanceAmount: 0, manualDeduction: 0,
          receivableId: null, deductions: 0, carryoverAmount: 0, payable: 1000, paidAmount: 0,
          paymentDate: null, secondPaidAmount: 0, secondPaymentDate: null,
          remainingAmount: 1000, overpaidAmount: 0, balanceAmount: 1000, net: 1000 }],
      };
      await query("INSERT INTO payroll_attendance_snapshots(month,payroll,advance) VALUES('2026-02',$1,'{}')", [JSON.stringify(saved)]);
      const result = await readPartyLedger(input);
      assert.equal(result.closingBalance, 80);
      assert.equal(result.payroll?.available, true);
      assert.equal(result.payroll?.payable, 1000);
      assert.equal(result.payroll?.paidAmount, 300);
      assert.equal(result.payroll?.balanceAmount, 700);
      assert.equal(result.payroll?.difference, 780);
      assert.equal((await query("SELECT count(*)::int AS n FROM journal_entries")).rows[0].n, 11);
    });
    await t.test("empty interval retains opening and conclusion, large range warns, GET has no data writes", async () => {
      const before = await query("SELECT count(*)::int AS n FROM journal_entries");
      const result = await readPartyLedger({ ...input, from: "2026-03-01", to: "2026-03-02" });
      assert.deepEqual(result.lines, []);
      assert.equal(result.openingBalance, 80);
      assert.equal(result.closingBalance, 80);
      assert.equal(result.totalDebit, 0);
      const long = await readPartyLedger({ ...input, to: "2028-03-01" });
      assert.ok(long.warnings.some(s => s.includes("2 жил")));
      assert.deepEqual((await query("SELECT count(*)::int AS n FROM journal_entries")).rows, before.rows);
      assert.equal(Number((await query("SELECT paid_amount FROM payroll_adjustments WHERE employee_id=1")).rows[0].paid_amount), 300);
    });
    await t.test("endpoint enforces both role and menu, validates real calendar dates and missing parties", async () => {
      const users = await db.select().from(usersTable);
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      const request = (id: number, params = "", path = "/ar-ap/party-ledger") => fetch(
        `${base}${path}?partyType=employee&partyId=1&from=2026-02-01&to=2026-02-28${params}`,
        { headers: { Cookie: `${hrCookie.name}=${createStaffSession(users.find(u=>u.id===id)!)}` } });
      for (const id of [1,2]) assert.equal((await request(id)).status, 200);
      for (const id of [3,4,5,6]) assert.equal((await request(id)).status, 403);
      assert.equal((await request(2, "", "/journal/suppliers")).status, 200);
      const cookie = `${hrCookie.name}=${createStaffSession(users[0])}`;
      for (const dates of ["from=2026-02-30&to=2026-03-01", "from=2026-03-01&to=2026-02-01"]) {
        assert.equal((await fetch(`${base}/ar-ap/party-ledger?partyType=employee&partyId=1&${dates}`, {headers:{Cookie:cookie}})).status, 400);
      }
      assert.equal((await fetch(`${base}/ar-ap/party-ledger?partyType=supplier&partyId=999&from=2026-02-01&to=2026-02-28`,{headers:{Cookie:cookie}})).status,404);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    mock.restoreAll();
    await query("RESET search_path");
    await query(`DROP SCHEMA "${schema}" CASCADE`);
    client.release();
    await pool.end();
  }
});
