import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { before, after, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, bankTransactionsTable, chartOfAccountsTable, employeesTable, inventorySuppliersTable,
  journalEntriesTable, journalLinesTable, receivablesTable, receivableAllocationsTable, payablesTable, payableAllocationsTable,
  operatingExpensesTable, cashTransactionsTable, usersTable,
} from "@workspace/db";
import app from "../app.js";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import { postJournalEntry } from "../lib/journal-posting.js";

describe("bank-sourced new receivables and payables", () => {
  const prefix = `bank-debt-${randomUUID()}`;
  let server: Server, root: string, cookie: string, viewerCookie: string, adminCookie: string;
  let employeeId: number, otherEmployeeId: number, supplierId: number, actorId: number;
  const users: number[] = [], banks: number[] = [];
  const accounts = new Map<string, number>();
  const call = (path: string, method = "GET", body?: unknown, auth = cookie) =>
    fetch(root + path, { method, headers: { cookie: auth, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const newBank = async (type: "income" | "expense", extra: Partial<typeof bankTransactionsTable.$inferInsert> = {}) => {
    const [bank] = await db.insert(bankTransactionsTable).values({
      type, amount: 734.25, transactionAt: new Date("2099-04-13T08:23:00Z"),
      account: prefix, counterparty: prefix, description: `${prefix} ${type}`,
      fingerprint: randomUUID(), ...extra,
    }).returning();
    banks.push(bank.id);
    return bank;
  };
  const payload = (type: "income" | "expense", partyType: "employee" | "supplier" = "employee") => ({
    accountId: accounts.get(type === "expense" ? "1200" : "2000"),
    allocation: { kind: "create", partyType, ...(partyType === "employee" ? { employeeId } : { supplierId }) },
  });
  const newDebt = async (paymentType: "income" | "expense", partyType: "employee" | "supplier" = "employee") => {
    const originType = paymentType === "income" ? "expense" : "income";
    const bank = await newBank(originType, { amount: 100.25, transactionAt: new Date("2099-04-01T09:00:00Z") });
    const response = await call(`/bank-transactions/${bank.id}/post-journal`, "POST", payload(originType, partyType));
    assert.equal(response.status, 200, await response.clone().text());
    const { journalEntryId } = await response.json();
    const [debt] = paymentType === "income"
      ? await db.select({ id: receivablesTable.id }).from(receivablesTable).where(eq(receivablesTable.originJournalEntryId, journalEntryId))
      : await db.select({ id: payablesTable.id }).from(payablesTable).where(eq(payablesTable.journalEntryId, journalEntryId));
    return {
      id: debt.id,
      data: {
        accountId: accounts.get(paymentType === "income" ? "1200" : "2000"),
        allocation: paymentType === "income"
          ? { kind: "settle", receivableId: debt.id } : { kind: "settle", payableId: debt.id },
      },
    };
  };
  const balance = async (type: "income" | "expense", id: number) => {
    const [row] = type === "income"
      ? await db.select({ amount: receivablesTable.openAmount, status: receivablesTable.status }).from(receivablesTable).where(eq(receivablesTable.id, id))
      : await db.select({ amount: payablesTable.remainingBalance, status: payablesTable.status }).from(payablesTable).where(eq(payablesTable.id, id));
    return { amount: Number(row.amount), status: row.status };
  };
  before(async () => {
    process.env.SESSION_SECRET = "bank-debt-test-session";
    for (const role of ["admin", "accountant", "viewer"] as const) {
      const [actor] = await db.insert(usersTable).values({
        username: `${prefix}-${role}`, normalizedUsername: `${prefix}-${role}`,
        passwordHash: "not-used", role, menuPaths: role === "admin" ? null : ["/bank-transactions"],
      }).returning();
      users.push(actor.id);
      if (role === "accountant") { actorId = actor.id; cookie = `${hrCookie.name}=${createStaffSession(actor)}`; }
      else if (role === "admin") adminCookie = `${hrCookie.name}=${createStaffSession(actor)}`;
      else viewerCookie = `${hrCookie.name}=${createStaffSession(actor)}`;
    }
    const employees = await db.insert(employeesTable).values([
      { name: `${prefix} first`, role: "test", baseSalary: 0 },
      { name: `${prefix} other`, role: "test", baseSalary: 0 },
    ]).returning();
    [employeeId, otherEmployeeId] = employees.map(e => e.id);
    const [supplier] = await db.insert(inventorySuppliersTable).values({ name: prefix, normalizedName: prefix }).returning();
    supplierId = supplier.id;
    for (const row of await db.select().from(chartOfAccountsTable).where(inArray(chartOfAccountsTable.code, ["1010", "1200", "2000", "1500", "1510", "1800"]))) {
      accounts.set(row.code, row.id);
    }
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async () => {
    const entries = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(inArray(journalEntriesTable.createdBy, users));
    const ids = entries.map(e => e.id);
    if (banks.length) await db.delete(bankTransactionsTable).where(inArray(bankTransactionsTable.id, banks));
    if (ids.length) {
      await db.delete(receivableAllocationsTable).where(inArray(receivableAllocationsTable.settlementJournalEntryId, ids));
      await db.delete(payableAllocationsTable).where(inArray(payableAllocationsTable.settlementJournalEntryId, ids));
      await db.delete(receivablesTable).where(inArray(receivablesTable.originJournalEntryId, ids));
      await db.delete(payablesTable).where(inArray(payablesTable.journalEntryId, ids));
      await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, ids));
    }
    if (employeeId) await db.delete(employeesTable).where(inArray(employeesTable.id, [employeeId, otherEmployeeId]));
    if (supplierId) await db.delete(inventorySuppliersTable).where(eq(inventorySuppliersTable.id, supplierId));
    if (users.length) await db.delete(usersTable).where(inArray(usersTable.id, users));
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("creates both kinds for employees and suppliers using only the stored bank date/amount", async () => {
    for (const type of ["expense", "income"] as const) for (const partyType of ["employee", "supplier"] as const) {
      const bank = await newBank(type);
      const response = await call(`/bank-transactions/${bank.id}/post-journal`, "POST", {
        ...payload(type, partyType), date: "2000-01-01", amount: 1,
      });
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json();
      const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, result.journalEntryId));
      assert.equal(entry.date, "2099-04-13");
      assert.equal(entry.sourceType, "bank");
      assert.equal(entry.sourceId, bank.id);
      assert.equal(entry.createdBy, actorId);
      assert.equal(entry.description, bank.description);
      const lines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, entry.id));
      assert.equal(lines.length, 2);
      assert.equal(lines.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0), 0);
      const sourceLine = lines.find(line => line.accountId === accounts.get(type === "expense" ? "1200" : "2000"))!;
      assert.equal(Number(type === "expense" ? sourceLine.debit : sourceLine.credit), 734.25);
      if (type === "expense") {
        const [debt] = await db.select().from(receivablesTable).where(eq(receivablesTable.originJournalEntryId, entry.id));
        assert.equal(debt.employeeId, partyType === "employee" ? employeeId : null);
        assert.equal(debt.supplierId, partyType === "supplier" ? supplierId : null);
        assert.equal(Number(debt.openAmount), 734.25);
      } else {
        const [debt] = await db.select().from(payablesTable).where(eq(payablesTable.journalEntryId, entry.id));
        assert.equal(debt.partyType, partyType);
        assert.equal(debt.partyId, partyType === "employee" ? employeeId : supplierId);
        assert.equal(Number(debt.remainingBalance), 734.25);
      }
      const [saved] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id));
      assert.equal(saved.journalEntryId, entry.id);
      assert.equal(saved.cashTransactionId, null);
      assert.equal(saved.transferredAt, null);
    }
  });

  it("serializes duplicate submissions and rejects changing the party after posting", async () => {
    const bank = await newBank("income");
    const responses = await Promise.all([1, 2].map(() => call(`/bank-transactions/${bank.id}/post-journal`, "POST", payload("income"))));
    assert.deepEqual(responses.map(r => r.status), [200, 200]);
    const ids = await Promise.all(responses.map(async r => (await r.json()).journalEntryId));
    assert.equal(ids[0], ids[1]);
    assert.equal((await db.select().from(payablesTable).where(eq(payablesTable.journalEntryId, ids[0]))).length, 1);
    const response = await call(`/bank-transactions/${bank.id}/post-journal`, "POST", {
      ...payload("income"), allocation: { kind: "create", partyType: "employee", employeeId: otherEmployeeId },
    });
    assert.equal(response.status, 409);
  });

  it("rejects invalid parties/directions atomically and preserves source-document guards", async () => {
    for (const data of [
      { ...payload("expense"), allocation: { kind: "create", partyType: "employee", employeeId: 2147483647 } },
      { ...payload("expense"), allocation: { kind: "create", partyType: "employee", employeeId: 2147483648 } },
      { ...payload("expense"), allocation: { kind: "create", partyType: "employee", employeeId, supplierId } },
      { ...payload("income") },
      { accountId: accounts.get("1200") },
    ]) {
      const bank = await newBank("expense");
      const response = await call(`/bank-transactions/${bank.id}/post-journal`, "POST", data);
      assert.equal(response.status, 400, await response.clone().text());
      const [saved] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id));
      assert.equal(saved.journalEntryId, null);
    }
    for (const code of ["1500", "1800"]) {
      const bank = await newBank("expense", { accountId: accounts.get(code) });
      assert.equal((await call(`/bank-transactions/${bank.id}/post-journal`, "POST", payload("expense"))).status, 409);
    }
  });

  it("allows bank-only lookups but neither employee mutations nor viewer posting", async () => {
    for (const path of ["/employees", "/journal/suppliers"]) assert.equal((await call(path)).status, 200);
    assert.equal((await call(`/employees/${employeeId}`, "PATCH", { name: "unauthorized" })).status, 403);
    const bank = await newBank("expense");
    assert.equal((await call(`/bank-transactions/${bank.id}/post-journal`, "POST", payload("expense"), viewerCookie)).status, 403);
  });

  it("bank cancellation reverses an untouched debt without leaving a payable or receivable", async () => {
    for (const type of ["expense", "income"] as const) {
      const bank = await newBank(type);
      const response = await call(`/bank-transactions/${bank.id}/post-journal`, "POST", payload(type));
      assert.equal(response.status, 200);
      const { journalEntryId } = await response.json();
      assert.equal((await call(`/bank-transactions/${bank.id}/journal`, "DELETE")).status, 403);
      const canceled = await call(`/bank-transactions/${bank.id}/journal`, "DELETE", undefined, adminCookie);
      assert.equal(canceled.status, 200, await canceled.clone().text());
      const [saved] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id));
      assert.equal(saved.journalEntryId, null);
      assert.equal((await db.select().from(receivablesTable).where(eq(receivablesTable.originJournalEntryId, journalEntryId))).length, 0);
      assert.equal((await db.select().from(payablesTable).where(eq(payablesTable.journalEntryId, journalEntryId))).length, 0);
    }
  });

  it("a concurrent employee deletion cannot leave a bank-funded employee payable orphaned", async () => {
    const bank = await newBank("income");
    const [posted, deleted] = await Promise.all([
      call(`/bank-transactions/${bank.id}/post-journal`, "POST", {
        ...payload("income"), allocation: { kind: "create", partyType: "employee", employeeId: otherEmployeeId },
      }),
      call(`/employees/${otherEmployeeId}`, "DELETE", undefined, adminCookie),
    ]);
    assert.ok(
      (posted.status === 200 && deleted.status === 409) || (posted.status === 400 && deleted.status === 204),
      `post=${posted.status} delete=${deleted.status}`,
    );
  });

  it("cannot cancel a bank-origin receivable after it has been settled", async () => {
    const bank = await newBank("expense");
    const created = await call(`/bank-transactions/${bank.id}/post-journal`, "POST", payload("expense"));
    const { journalEntryId } = await created.json();
    const [debt] = await db.select().from(receivablesTable).where(eq(receivablesTable.originJournalEntryId, journalEntryId));
    await db.transaction(tx => postJournalEntry(tx, {
      date: "2099-04-14", description: prefix, sourceType: "manual", sourceId: null, createdBy: actorId,
      lines: [
        { accountId: accounts.get("1010")!, debit: 734.25, credit: 0 },
        { accountId: accounts.get("1200")!, debit: 0, credit: 734.25, allocation: { kind: "settle", receivableId: debt.id } },
      ],
    }));
    assert.equal((await call(`/bank-transactions/${bank.id}/journal`, "DELETE", undefined, adminCookie)).status, 409);
    const [saved] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id));
    assert.equal(saved.journalEntryId, journalEntryId);
  });

  it("settles employee/supplier receivables and payables partially using authoritative bank values, without expenses or cash mirrors", async () => {
    for (const type of ["income", "expense"] as const) for (const partyType of ["employee", "supplier"] as const) {
      const debt = await newDebt(type, partyType);
      const bank = await newBank(type, { amount: 40.25 });
      const response = await call(`/bank-transactions/${bank.id}/post-journal`, "POST", {
        ...debt.data, date: "2000-01-01", amount: 1,
      });
      assert.equal(response.status, 200, await response.clone().text());
      const { journalEntryId } = await response.json();
      assert.deepEqual(await balance(type, debt.id), { amount: 60, status: "open" });
      const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, journalEntryId));
      assert.equal(entry.date, "2099-04-13");
      assert.equal(entry.description, bank.description);
      assert.equal(entry.createdBy, actorId);
      assert.equal(entry.sourceType, "bank");
      assert.equal(entry.sourceId, bank.id);
      const lines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, journalEntryId));
      assert.equal(lines.length, 2);
      assert.equal(lines.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0), 0);
      const debtLine = lines.find(line => line.accountId === debt.data.accountId)!;
      assert.equal(Number(type === "income" ? debtLine.credit : debtLine.debit), 40.25);
      assert.deepEqual(debtLine.allocation, debt.data.allocation);
      const [saved] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id));
      assert.equal(saved.journalEntryId, journalEntryId);
      assert.equal(saved.cashTransactionId, null);
      assert.equal(saved.transferredAt, null);
      assert.equal((await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.bankTransactionId, bank.id))).length, 0);
      assert.equal((await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.bankTransactionId, bank.id))).length, 0);
    }
  });

  it("full settlement closes debt, rejects stale re-payment, and cancellation restores the original balance", async () => {
    for (const type of ["income", "expense"] as const) {
      const debt = await newDebt(type);
      const bank = await newBank(type, { amount: 100.25 });
      const paid = await call(`/bank-transactions/${bank.id}/post-journal`, "POST", debt.data);
      assert.equal(paid.status, 200, await paid.clone().text());
      assert.deepEqual(await balance(type, debt.id), { amount: 0, status: type === "income" ? "settled" : "closed" });
      const otherBank = await newBank(type, { amount: 1 });
      assert.equal((await call(`/bank-transactions/${otherBank.id}/post-journal`, "POST", debt.data)).status, 409);
      assert.equal((await call(`/bank-transactions/${bank.id}/journal`, "DELETE")).status, 403);
      const canceled = await call(`/bank-transactions/${bank.id}/journal`, "DELETE", undefined, adminCookie);
      assert.equal(canceled.status, 200, await canceled.clone().text());
      assert.deepEqual(await balance(type, debt.id), { amount: 100.25, status: "open" });
      const [saved] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id));
      assert.equal(saved.journalEntryId, null);
    }
  });

  it("duplicate bank settlement is idempotent, while switching debt or allocation kind is a conflict", async () => {
    for (const type of ["income", "expense"] as const) {
      const debt = await newDebt(type), otherDebt = await newDebt(type);
      const bank = await newBank(type, { amount: 40.25 });
      const responses = await Promise.all([1, 2].map(() => call(`/bank-transactions/${bank.id}/post-journal`, "POST", debt.data)));
      assert.deepEqual(responses.map(r => r.status), [200, 200]);
      const entries = await Promise.all(responses.map(async r => (await r.json()).journalEntryId));
      assert.equal(entries[0], entries[1]);
      assert.deepEqual(await balance(type, debt.id), { amount: 60, status: "open" });
      const allocations = type === "income"
        ? await db.select().from(receivableAllocationsTable).where(eq(receivableAllocationsTable.settlementJournalEntryId, entries[0]))
        : await db.select().from(payableAllocationsTable).where(eq(payableAllocationsTable.settlementJournalEntryId, entries[0]));
      assert.equal(allocations.length, 1);
      assert.equal((await call(`/bank-transactions/${bank.id}/post-journal`, "POST", otherDebt.data)).status, 409);
      assert.equal((await call(`/bank-transactions/${bank.id}/post-journal`, "POST", payload(type))).status, 409);
      assert.deepEqual(await balance(type, otherDebt.id), { amount: 100.25, status: "open" });
    }
  });

  it("two different bank payments cannot concurrently over-settle one debt", async () => {
    for (const type of ["income", "expense"] as const) {
      const debt = await newDebt(type);
      const bankA = await newBank(type, { amount: 70 }), bankB = await newBank(type, { amount: 70 });
      const responses = await Promise.all([bankA, bankB].map(bank => call(`/bank-transactions/${bank.id}/post-journal`, "POST", debt.data)));
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
      assert.deepEqual(await balance(type, debt.id), { amount: 30.25, status: "open" });
      const rows = await db.select().from(bankTransactionsTable).where(inArray(bankTransactionsTable.id, [bankA.id, bankB.id]));
      assert.equal(rows.filter(row => row.journalEntryId !== null).length, 1);
    }
  });

  it("invalid/mixed targets, overpayments, wrong directions/accounts and pre-origin dates roll back completely", async () => {
    const payable = await newDebt("expense"), receivable = await newDebt("income");
    const cases = [
      { data: payable.data, amount: 100.26, status: 409 },
      { data: receivable.data, amount: 1, status: 400 },
      { data: { ...payable.data, accountId: accounts.get("1010") }, amount: 1, status: 400 },
      { data: { ...payable.data, allocation: { kind: "settle", payableId: 2147483647 } }, amount: 1, status: 404 },
      { data: { ...payable.data, allocation: { kind: "settle", payableId: 2147483648 } }, amount: 1, status: 400 },
      { data: { ...payable.data, allocation: { kind: "settle", payableId: 0 } }, amount: 1, status: 400 },
      { data: { ...payable.data, allocation: { kind: "settle", payableId: payable.id, receivableId: receivable.id } }, amount: 1, status: 400 },
      { data: { ...payable.data, allocation: { kind: "settle", payableId: payable.id, employeeId } }, amount: 1, status: 400 },
      { data: payable.data, amount: 1, status: 400, date: "2099-03-31T12:00:00Z" },
    ];
    for (const item of cases) {
      const bank = await newBank("expense", { amount: item.amount, ...(item.date ? { transactionAt: new Date(item.date) } : {}) });
      const response = await call(`/bank-transactions/${bank.id}/post-journal`, "POST", item.data);
      assert.equal(response.status, item.status, await response.clone().text());
      const [saved] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id));
      assert.equal(saved.journalEntryId, null);
      assert.equal((await db.select().from(journalEntriesTable).where(and(
        eq(journalEntriesTable.sourceType, "bank"), eq(journalEntriesTable.sourceId, bank.id),
      ))).length, 0);
    }
    assert.deepEqual(await balance("income", receivable.id), { amount: 100.25, status: "open" });
    assert.deepEqual(await balance("expense", payable.id), { amount: 100.25, status: "open" });
  });

  it("bank settlement retains purchase/fixed-asset guards and bank-only menu role boundaries", async () => {
    const debt = await newDebt("expense");
    for (const code of ["1500", "1510", "1800"]) {
      const bank = await newBank("expense", { amount: 1, accountId: accounts.get(code) });
      assert.equal((await call(`/bank-transactions/${bank.id}/post-journal`, "POST", debt.data)).status, 409);
    }
    for (const path of ["/journal/receivables", "/journal/payables"]) assert.equal((await call(path)).status, 200);
    assert.equal((await call("/journal/entries")).status, 403);
    assert.equal((await call("/journal/entries", "POST", {})).status, 403);
    const bank = await newBank("expense", { amount: 1 });
    assert.equal((await call(`/bank-transactions/${bank.id}/post-journal`, "POST", debt.data, viewerCookie)).status, 403);
    assert.deepEqual(await balance("expense", debt.id), { amount: 100.25, status: "open" });
  });

  it("canceling one partial payment preserves another payment and restores only the canceled allocation", async () => {
    for (const type of ["income", "expense"] as const) {
      const debt = await newDebt(type);
      const bankA = await newBank(type, { amount: 40 }), bankB = await newBank(type, { amount: 20 });
      for (const bank of [bankA, bankB]) {
        assert.equal((await call(`/bank-transactions/${bank.id}/post-journal`, "POST", debt.data)).status, 200);
      }
      assert.deepEqual(await balance(type, debt.id), { amount: 40.25, status: "open" });
      assert.equal((await call(`/bank-transactions/${bankA.id}/journal`, "DELETE", undefined, adminCookie)).status, 200);
      assert.deepEqual(await balance(type, debt.id), { amount: 80.25, status: "open" });
      const [preserved] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankB.id));
      assert.notEqual(preserved.journalEntryId, null);
    }
  });
});
