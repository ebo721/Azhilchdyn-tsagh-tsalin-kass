import assert from "node:assert/strict";
import { after, it } from "node:test";
import { pool } from "@workspace/db";
import { GetDashboardQueryParams } from "@workspace/api-zod";
import { readDashboardSummary } from "./dashboard-summary.js";
import { defaultPayrollSchedule } from "./route-shared.js";

after(() => pool.end());

it("validates month-shaped dashboard queries", () => {
  for (const month of ["2026-00", "2026-13", "2026-1", "not-a-month", "2026-09-01"]) {
    assert.equal(GetDashboardQueryParams.safeParse({ month }).success, false);
  }
  assert.deepEqual(GetDashboardQueryParams.parse({ month: "2026-09" }), { month: "2026-09" });
});

it("monthly dashboard reads correct source totals and saved gross without financial writes", async t => {
  if (process.env.PRODUCTION_DATABASE_URL && process.env.DATABASE_URL === process.env.PRODUCTION_DATABASE_URL) {
    throw new Error("Refusing tests against production");
  }
  const schema = `dashboard_test_${Date.now()}`;
  const client = await pool.connect();
  const query = client.query.bind(client);
  await query(`CREATE SCHEMA ${schema}`);
  try {
    const tables = ["employees", "cash_transactions", "bank_transactions", "chart_of_accounts", "inventory_purchases",
      "operating_expenses", "payroll_attendance_snapshots", "payroll_month_closures", "payroll_month_balances",
      "shift_templates", "employee_shift_plans", "attendance", "fixed_assets"];
    await query(tables.map(table => `CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`).join(";"));
    await query(`SET search_path TO ${schema}`);
    t.mock.method(pool, "connect", (() => Promise.resolve({ query, release() {} } as unknown as typeof client)) as typeof pool.connect);
    t.mock.method(pool, "query", query as typeof pool.query);
    await query(`
      INSERT INTO employees (id,name,role,base_salary,joined_at) VALUES (1,'Office','test',1000,'2026-01-01'),(2,'Shift','test',300,'2026-01-01');
      INSERT INTO chart_of_accounts (id,code,name,type,normal_balance) VALUES (1,'1500','Inventory','asset','debit'),(2,'1510','Supply','asset','debit'),(3,'6900','Expense','expense','debit');
      INSERT INTO cash_transactions (id,type,category,description,amount,date,income_month,unclear_at)
        VALUES (1,'income','test','September revenue paid in October',500,'2026-10-02','2026-09',NULL),
               (2,'income','test','Unclear excluded',100,'2026-09-02','2026-09',now()),
               (3,'income','test','August excluded',999,'2026-09-02','2026-08',NULL),
               (4,'expense','test','Unclear expense',88,'2026-09-02',NULL,now());
      INSERT INTO inventory_purchases (id,date,total_amount,material_type,payment_date,document_number)
        VALUES (1,'2026-09-01',120,'food','2026-10-03','test-1'),(2,'2026-09-30',30,'food',NULL,'test-2'),
               (3,'2026-09-04',80,'supply',NULL,'test-3'),(4,'2026-10-01',999,'food',NULL,'test-4');
      INSERT INTO operating_expenses (id,description,category_id,date,amount,payment_date,cash_transaction_id)
        VALUES (1,'Unpaid',3,'2026-09-01',200,NULL,NULL),(2,'Paid',3,'2026-09-30',40,'2026-10-01',NULL),
               (3,'Other month',3,'2026-10-01',999,NULL,NULL),(4,'Unclear',3,'2026-09-01',88,NULL,4);
      INSERT INTO bank_transactions (id,transaction_at,type,amount,account_id,fingerprint,cash_transaction_id)
        VALUES (10,'2026-09-05','expense',25,1,'dashboard-pending-food',10),
               (11,'2026-09-05','expense',35,2,'dashboard-pending-supply',11),
               (12,'2026-09-05','expense',999,1,'dashboard-converted',12);
      INSERT INTO cash_transactions (id,type,category,description,amount,date,bank_transaction_id,source_type,source_key)
        VALUES (10,'expense','test','Pending food',25,'2026-09-05',10,'bank_transaction','pending-purchase:10'),
               (11,'expense','test','Pending supply',35,'2026-09-05',11,'bank_transaction','pending-purchase:11'),
               (12,'expense','test','Converted - not pending',999,'2026-09-05',12,'inventory_purchase','purchase:1');
      INSERT INTO shift_templates (id,name,start_time,end_time) VALUES (1,'First','08:00','16:00'),(2,'Second','16:00','23:00');
      INSERT INTO employee_shift_plans (id,employee_id,date,shift_id) VALUES (1,2,'2026-08-30',1),(2,2,'2026-09-01',2);
      INSERT INTO attendance (id,employee_id,date,clock_in,clock_out,hours,status)
        VALUES (1,2,'2026-08-30','08:00','16:00',8,'present'),(2,2,'2026-09-01','16:00','23:00',7,'late');
      UPDATE inventory_purchases SET created_at=now()+interval '1 second' WHERE id=2;
    `);
    const line = (employeeId: number, employeeType: "office" | "shift", gross: number) => ({
      employeeId, employeeName: "Test", role: "test", employeeType, daysWorked: 2, hours: 16, gross,
      socialInsuranceSalary: 0, socialInsurance: 0, taxableIncome: 0, calculatedIncomeTax: 0,
      taxRelief: 0, incomeTax: 0, advanceAmount: 99, manualDeduction: 10, receivableId: null,
      deductions: 109, carryoverAmount: 999, payable: 0, paidAmount: 77, paymentDate: null,
      secondPaidAmount: 0, secondPaymentDate: null, remainingAmount: 0, overpaidAmount: 0, balanceAmount: 0, net: 0,
    });
    const payroll = {
      month: "2026-09", periodStart: "2026-08-25", advancePeriodEnd: "2026-09-10", periodEnd: "2026-09-24",
      advancePaymentDate: "2026-09-15", finalPaymentDate: "2026-10-01",
      schedule: { ...defaultPayrollSchedule, id: 1, effectiveFromMonth: "0001-01" },
      totalGross: 1300, totalSocialInsurance: 0, totalIncomeTax: 0, totalDeductions: 218, totalNet: 0,
      lines: [line(1, "office", 1000), line(2, "shift", 300)],
    };
    await query(`INSERT INTO payroll_attendance_snapshots (month,payroll,advance) VALUES ('2026-09',$1,'{}')`, [JSON.stringify(payroll)]);
    await t.test("uses assigned income month, separates food/supply including pending, and includes unpaid expenses", async () => {
      const summary = await readDashboardSummary("2026-09");
      assert.equal(summary.salesIncome, 500);
      assert.equal(summary.inventoryPurchaseTotal, 175);
      assert.equal(summary.supplyPurchaseTotal, 115);
      assert.equal(summary.operatingExpenseTotal, 240);
      assert.equal(summary.payrollGross, 1300);
      assert.equal(summary.officePayrollGross, 1000);
      assert.deepEqual(summary.payrollByShift.map(row => row.gross), [150, 150]);
      assert.equal(summary.payrollStatus, "saved");
      assert.equal(summary.employeeCount, 2);
      assert.ok(summary.recentActivity.some(item => item.id === "inventory-purchase-2"));
      assert.ok(summary.recentActivity.every(item => item.id !== "inventory-purchase-4"));
    });
    await t.test("missing payroll stays null and other months remain independent", async () => {
      const summary = await readDashboardSummary("2026-10");
      assert.equal(summary.payrollGross, null);
      assert.equal(summary.officePayrollGross, null);
      assert.equal(summary.payrollStatus, "missing");
      assert.deepEqual(summary.payrollByShift, []);
      assert.equal(summary.inventoryPurchaseTotal, 999);
      assert.equal(summary.salesIncome, 0);
    });
    await query(`INSERT INTO payroll_month_balances(month,period_start,period_end,lines,dirty) VALUES ('2026-09','2026-08-25','2026-09-24','[]',true)`);
    await t.test("stale saved payroll is displayed, not pulled or replaced", async () => {
      const summary = await readDashboardSummary("2026-09");
      assert.equal(summary.payrollStatus, "stale");
      assert.equal(summary.payrollGross, 1300);
      assert.equal((await query(`SELECT payroll->>'totalGross' AS gross FROM payroll_attendance_snapshots`)).rows[0].gross, "1300");
    });
    const closed = { ...payroll, totalGross: 1299, lines: [line(1, "office", 999), line(2, "shift", 300)] };
    await query(`INSERT INTO payroll_month_closures(month,payroll,advance,closed_by) VALUES ('2026-09',$1,'{}',1)`, [JSON.stringify(closed)]);
    await t.test("closed payroll takes precedence over a newer mutable snapshot", async () => {
      const summary = await readDashboardSummary("2026-09");
      assert.equal(summary.payrollStatus, "closed");
      assert.equal(summary.payrollGross, 1299);
      assert.equal(summary.officePayrollGross, 999);
    });
  } finally {
    t.mock.restoreAll();
    await query(`SET search_path TO public; DROP SCHEMA ${schema} CASCADE`);
    client.release();
  }
});
