import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  cashTransactionsTable,
  chartOfAccountsTable,
  db,
  employeesTable,
  journalEntriesTable,
  journalLinesTable,
  payrollAdjustmentsTable,
  receivableAllocationsTable,
  receivablesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createStaffSession, hrCookie } from "../lib/hr-session";
import { postJournalEntry, voidJournalEntry } from "../lib/journal-posting";

describe("payroll receivable deductions", () => {
  const month = "2099-12";
  let server: Server;
  let baseUrl: string;
  let adminCookie: string;
  let employeeId: number;
  let receivableId: number;
  let originJournalEntryId: number;

  before(async () => {
    process.env.SESSION_SECRET = "payroll-receivable-test";
    const [admin] = await db.select().from(usersTable).where(eq(usersTable.role, "admin")).limit(1);
    assert.ok(admin, "An admin database user is required for the integration test");
    adminCookie = `${hrCookie.name}=${createStaffSession(admin)}`;

    const [employee] = await db.insert(employeesTable).values({
      name: `Payroll receivable ${process.pid}`,
      role: "test",
      baseSalary: 1_000_000,
    }).returning({ id: employeesTable.id });
    employeeId = employee.id;

    const accounts = await db.select({ id: chartOfAccountsTable.id, code: chartOfAccountsTable.code })
      .from(chartOfAccountsTable)
      .where(inArray(chartOfAccountsTable.code, ["1000", "1200"]));
    const accountByCode = new Map(accounts.map((account) => [account.code, account.id]));
    const cashAccountId = accountByCode.get("1000");
    const receivableAccountId = accountByCode.get("1200");
    assert.ok(cashAccountId && receivableAccountId);

    const origin = await db.transaction((tx) => postJournalEntry(tx, {
      date: "2099-12-01",
      description: "Payroll deduction test receivable",
      sourceType: "test",
      sourceId: null,
      createdBy: null,
      lines: [
        {
          accountId: receivableAccountId,
          debit: 100_000,
          credit: 0,
          allocation: { kind: "create", partyType: "employee", employeeId },
        },
        { accountId: cashAccountId, debit: 0, credit: 100_000 },
      ],
    }));
    originJournalEntryId = origin.journalEntryId;
    const [receivable] = await db.select().from(receivablesTable)
      .where(eq(receivablesTable.originJournalEntryId, originJournalEntryId));
    assert.ok(receivable);
    assert.equal(receivable.employeeId, employeeId);
    receivableId = receivable.id;

    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await db.delete(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "payroll"),
      eq(cashTransactionsTable.sourceKey, `${month}:${employeeId}`),
    ));
    await db.delete(payrollAdjustmentsTable).where(and(
      eq(payrollAdjustmentsTable.employeeId, employeeId),
      eq(payrollAdjustmentsTable.month, month),
    ));
    const [origin] = await db.select({ status: journalEntriesTable.status })
      .from(journalEntriesTable)
      .where(eq(journalEntriesTable.id, originJournalEntryId));
    if (origin?.status === "posted") {
      await db.transaction((tx) => voidJournalEntry(tx, { journalEntryId: originJournalEntryId, voidedBy: null }));
    }
    const createdEntries = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(and(
        inArray(journalEntriesTable.sourceType, ["test", "payroll_receivable", "reversal"]),
        inArray(journalEntriesTable.description, [
          "Payroll deduction test receivable",
          `Reversal: Payroll deduction test receivable`,
          `Payroll receivable ${process.pid} · ${month} сарын цалингаас авлага суутгав`,
          `Reversal: Payroll receivable ${process.pid} · ${month} сарын цалингаас авлага суутгав`,
        ]),
      ));
    if (createdEntries.length) {
      await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, createdEntries.map((entry) => entry.id)));
    }
    await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
    server.close();
  });

  it("settles within the payroll transaction and restores the balance when the payment is removed", async () => {
    const saveResponse = await fetch(`${baseUrl}/api/payroll-adjustments`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        employeeId,
        month,
        manualDeduction: 40_000,
        receivableId,
        paidAmount: 500_000,
        paymentDate: "2099-12-25",
        secondPaidAmount: 0,
        secondPaymentDate: null,
      }),
    });
    const saveBody = await saveResponse.text();
    assert.equal(saveResponse.status, 200, saveBody);

    const [adjustment] = await db.select().from(payrollAdjustmentsTable)
      .where(and(eq(payrollAdjustmentsTable.employeeId, employeeId), eq(payrollAdjustmentsTable.month, month)));
    assert.ok(adjustment?.journalEntryId);
    const [receivableAfterSave] = await db.select().from(receivablesTable)
      .where(eq(receivablesTable.id, receivableId));
    assert.equal(Number(receivableAfterSave.openAmount), 60_000);
    const allocations = await db.select().from(receivableAllocationsTable)
      .where(eq(receivableAllocationsTable.receivableId, receivableId));
    assert.equal(allocations.length, 1);
    assert.equal(Number(allocations[0].amount), 40_000);
    const lines = await db.select().from(journalLinesTable)
      .where(eq(journalLinesTable.journalEntryId, adjustment.journalEntryId));
    assert.equal(lines.reduce((sum, line) => sum + Number(line.debit), 0), 40_000);
    assert.equal(lines.reduce((sum, line) => sum + Number(line.credit), 0), 40_000);

    const deleteResponse = await fetch(
      `${baseUrl}/api/payroll-adjustments/${month}/${employeeId}/transactions/1`,
      { method: "DELETE", headers: { cookie: adminCookie } },
    );
    assert.equal(deleteResponse.status, 204);
    const [receivableAfterDelete] = await db.select().from(receivablesTable)
      .where(eq(receivablesTable.id, receivableId));
    assert.equal(Number(receivableAfterDelete.openAmount), 100_000);
    const allocationsAfterDelete = await db.select().from(receivableAllocationsTable)
      .where(eq(receivableAllocationsTable.receivableId, receivableId));
    assert.equal(allocationsAfterDelete.length, 0);
  });
});