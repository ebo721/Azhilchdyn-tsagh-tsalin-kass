import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import {
  db, pool, usersTable, bankTransactionsTable, cashTransactionsTable, cashClosuresTable,
  chartOfAccountsTable, inventoryItemsTable, inventoryPurchasesTable, inventorySuppliersTable,
  journalEntriesTable, journalLinesTable, operatingExpensesTable,
  inventoryPurchasePaymentGroupsTable, inventoryPurchasePaymentGroupMembersTable,
} from "@workspace/db";
import app from "../app";
import { createStaffSession, hrCookie } from "../lib/hr-session";

describe("bank purchases awaiting item details", () => {
  const prefix = `pending-purchase-test-${randomUUID()}`;
  const banks: number[] = [], users: number[] = [], journalIds: number[] = [], cashIds: number[] = [], purchases: number[] = [];
  const accounts: Record<string, number> = {};
  const groups: number[] = [];
  const cookies: Record<string, string> = {};
  let server: Server, base: string;
  const call = (path: string, method = "GET", data?: unknown, role = "admin") => fetch(`${base}/api${path}`, {
    method, headers: { cookie: cookies[role], "content-type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  async function bank(code = "1500", date = "2098-06-15") {
    const [row] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date(`${date}T09:00:00Z`), type: "expense", amount: 83.45,
      account: prefix, counterparty: "", description: prefix, fingerprint: randomUUID(), accountId: accounts[code],
    }).returning();
    banks.push(row.id);
    return row;
  }
  const input = (type = "food") => ({
    materialType: type, date: "2098-06-15", supplierName: `${prefix}-supplier`, hasReceipt: false,
    items: [{ name: `${prefix}-${type}`, category: "test", unit: "ширхэг", quantity: 1, unitPrice: 83.45 }],
  });
  before(async () => {
    for (const role of ["admin", "accountant", "warehouse", "viewer"] as const) {
      const [user] = await db.insert(usersTable).values({
        username: `${prefix}-${role}`, normalizedUsername: `${prefix}-${role}`, passwordHash: "unused", role,
      }).returning();
      users.push(user.id);
      cookies[role] = `${hrCookie.name}=${createStaffSession(user)}`;
    }
    for (const row of await db.select().from(chartOfAccountsTable).where(inArray(chartOfAccountsTable.code, ["1500", "1510", "6900"]))) accounts[row.code] = row.id;
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    // Capture both successful and failed-test fixtures, including cancellation reversals.
    const cash = await db.select().from(cashTransactionsTable).where(inArray(cashTransactionsTable.bankTransactionId, banks));
    cashIds.push(...cash.map(row => row.id));
    journalIds.push(...cash.flatMap(row => row.journalEntryId ? [row.journalEntryId] : []));
    purchases.push(...(await db.select().from(inventoryPurchasesTable).where(like(inventoryPurchasesTable.documentName, `${prefix}%`))).map(row => row.id));
    const journals = await db.select().from(journalEntriesTable).where(like(journalEntriesTable.description, `%${prefix}%`));
    journalIds.push(...journals.map(row => row.id));
    if (groups.length) await db.delete(inventoryPurchasePaymentGroupsTable).where(inArray(inventoryPurchasePaymentGroupsTable.id, groups));
    if (banks.length) await db.delete(bankTransactionsTable).where(inArray(bankTransactionsTable.id, banks));
    if (cashIds.length) await db.delete(cashTransactionsTable).where(inArray(cashTransactionsTable.id, cashIds));
    if (purchases.length) await db.delete(inventoryPurchasesTable).where(inArray(inventoryPurchasesTable.id, purchases));
    if (journalIds.length) await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, journalIds));
    await db.delete(inventoryItemsTable).where(like(inventoryItemsTable.name, `${prefix}%`));
    await db.delete(inventorySuppliersTable).where(like(inventorySuppliersTable.name, `${prefix}%`));
    await db.delete(usersTable).where(inArray(usersTable.id, users));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  });

  it("suggests unlinked matching amounts or types and reuses accounting when linking an existing purchase", async () => {
    const row = await bank();
    const postedResponse = await call(`/bank-transactions/${row.id}/post-journal`, "POST", { accountId: accounts["1500"] });
    assert.equal(postedResponse.status, 200);
    const posted = await postedResponse.json();
    journalIds.push(posted.journalEntryId);
    const [saved] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, row.id));
    cashIds.push(saved.cashTransactionId!);
    const fixture = async (materialType = "food", totalAmount = 83.45, paymentDate: string | null = null, date = "2098-06-14") => {
      const [purchase] = await db.insert(inventoryPurchasesTable).values({
        materialType, totalAmount, paymentDate, date, documentName: prefix,
        accountId: accounts[materialType === "food" ? "1500" : "1510"],
      }).returning();
      purchases.push(purchase.id);
      return purchase.id;
    };
    const exact = await fixture();
    const sameType = await fixture("food", 25);
    const sameAmount = await fixture("supply");
    const neither = await fixture("supply", 25);
    const paid = await fixture("food", 83.45, "2098-06-14");
    const future = await fixture("food", 83.45, null, "2098-06-16");
    const cashLinked = await fixture();
    const [cash] = await db.insert(cashTransactionsTable).values({
      type: "expense", category: "Бараа материал", description: prefix,
      date: "2098-06-14", amount: 83.45, sourceType: "inventory_purchase", sourceKey: `purchase:${cashLinked}`,
    }).returning();
    cashIds.push(cash.id);
    const grouped = await fixture();
    const cancelledGroupPurchase = await fixture();
    for (const status of ["active", "cancelled"]) {
      const [group] = await db.insert(inventoryPurchasePaymentGroupsTable).values({
        bankTransactionId: row.id, journalEntryId: posted.journalEntryId, status,
        cancelledAt: status === "cancelled" ? new Date() : null,
      }).returning();
      groups.push(group.id);
      await db.insert(inventoryPurchasePaymentGroupMembersTable).values({
        groupId: group.id, purchaseId: status === "active" ? grouped : cancelledGroupPurchase,
      });
    }
    const list = await call(`/inventory/pending-purchases/${row.id}/suggestions`, "GET", undefined, "warehouse");
    assert.equal(list.status, 200);
    const suggestions = await list.json();
    assert.ok(suggestions.some((p: any) => p.id === exact && p.linkable));
    assert.ok(suggestions.some((p: any) => p.id === sameType && p.sameType && !p.linkable));
    assert.ok(suggestions.some((p: any) => p.id === sameAmount && p.sameAmount && !p.linkable));
    assert.ok(suggestions.some((p: any) => p.id === cancelledGroupPurchase && p.linkable));
    for (const id of [neither, paid, future, cashLinked, grouped]) assert.ok(!suggestions.some((p: any) => p.id === id));
    for (const id of [sameType, sameAmount, paid, future, cashLinked, grouped]) {
      assert.equal((await call(`/inventory/pending-purchases/${row.id}/register`, "POST", { inventoryPurchaseId: id }, "warehouse")).status, 409);
    }
    assert.equal((await call(`/inventory/pending-purchases/${row.id}/register`, "POST", { inventoryPurchaseId: exact }, "viewer")).status, 403);
    const results = await Promise.all([1, 2].map(() => call(`/inventory/pending-purchases/${row.id}/register`, "POST", { inventoryPurchaseId: exact }, "warehouse")));
    assert.deepEqual(results.map(r => r.status), [200, 200]);
    const linked = await results[0].json();
    assert.equal(linked.inventoryPurchaseId, exact);
    assert.equal(linked.journalEntryId, posted.journalEntryId);
    assert.equal(linked.cashTransactionId, saved.cashTransactionId);
    const purchaseList = await (await call("/inventory/purchases")).json();
    const exactResult = purchaseList.find((p: any) => p.id === exact);
    assert.equal(exactResult.paid, true);
    assert.equal(exactResult.bankConnection.id, row.id);
    assert.equal(exactResult.bankConnection.kind, "single");
    assert.equal(exactResult.bankConnection.amount, 83.45);
    assert.equal(exactResult.bankConnection.description, prefix);
    assert.equal(purchaseList.find((p: any) => p.id === paid).bankConnection, null);
    assert.equal(purchaseList.find((p: any) => p.id === neither).bankConnection, null);
    assert.equal(purchaseList.find((p: any) => p.id === cashLinked).bankConnection, null);
    assert.equal(purchaseList.find((p: any) => p.id === cancelledGroupPurchase).bankConnection, null);
    const [purchase] = await db.select().from(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, exact));
    assert.equal(purchase.date, "2098-06-14");
    assert.equal(purchase.paymentDate, "2098-06-15");
    const second = await bank();
    const posted2 = await (await call(`/bank-transactions/${second.id}/post-journal`, "POST", { accountId: accounts["1500"] })).json();
    journalIds.push(posted2.journalEntryId);
    const [saved2] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, second.id));
    cashIds.push(saved2.cashTransactionId!);
    const remaining = await (await call(`/inventory/pending-purchases/${second.id}/suggestions`)).json();
    assert.ok(!remaining.some((p: any) => p.id === exact));
    assert.equal((await call(`/inventory/pending-purchases/${second.id}/register`, "POST", { inventoryPurchaseId: exact }, "warehouse")).status, 409);
  });

  for (const [code, type] of [["1500", "food"], ["1510", "supply"]]) {
    it(`${code}: posts cash and journal once, completes stock once, preserves the existing cancellation flow`, async () => {
      const row = await bank(code);
      const responses = await Promise.all([1, 2].map(() => call(`/bank-transactions/${row.id}/post-journal`, "POST", { accountId: accounts[code] }, "accountant")));
      assert.deepEqual(responses.map(r => r.status), [200, 200]);
      const posted = await responses[0].json();
      assert.equal((await responses[1].json()).journalEntryId, posted.journalEntryId);
      journalIds.push(posted.journalEntryId);
      const [saved] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, row.id));
      assert.ok(saved.cashTransactionId);
      cashIds.push(saved.cashTransactionId);
      assert.equal((await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.name, `${prefix}-${type}`))).length, 0);
      const pending = await (await call("/inventory/pending-purchases", "GET", undefined, "warehouse")).json();
      assert.ok(pending.some((item: { id: number; accountCode: string; amount: number }) => item.id === row.id && item.accountCode === code && item.amount === 83.45));
      assert.equal((await call(`/bank-transactions/${row.id}/unlink-cash`, "POST", {})).status, 409);
      const wrong = input(type); wrong.items[0].unitPrice = 83.44;
      assert.equal((await call(`/inventory/pending-purchases/${row.id}/register`, "POST", wrong, "warehouse")).status, 409);
      const wrongType = input(type === "food" ? "supply" : "food");
      assert.equal((await call(`/inventory/pending-purchases/${row.id}/register`, "POST", wrongType)).status, 409);
      assert.equal((await call(`/inventory/pending-purchases/${row.id}/register`, "POST", input(type), "viewer")).status, 403);
      const complete = await Promise.all([1, 2].map(() => call(`/inventory/pending-purchases/${row.id}/register`, "POST", input(type), "warehouse")));
      assert.deepEqual(complete.map(r => r.status), [200, 200]);
      const linked = await complete[0].json();
      assert.equal((await complete[1].json()).inventoryPurchaseId, linked.inventoryPurchaseId);
      purchases.push(linked.inventoryPurchaseId);
      assert.equal(linked.cashTransactionId, saved.cashTransactionId);
      assert.equal(linked.journalEntryId, posted.journalEntryId);
      const [stock] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.name, `${prefix}-${type}`));
      assert.equal(Number(stock.quantity), 1);
      const [purchase] = await db.select().from(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, linked.inventoryPurchaseId));
      assert.equal(Number(purchase.paymentAmount), 83.45);
      assert.equal(purchase.paymentDate, "2098-06-15");
      assert.equal((await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.bankTransactionId, row.id))).length, 1);
      const lines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, posted.journalEntryId));
      assert.equal(lines.length, 2);
      assert.equal(lines.reduce((sum, line) => sum + Number(line.debit), 0), 83.45);
      assert.equal((await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.bankTransactionId, row.id))).length, 0);
      const listed = await (await call("/inventory/pending-purchases")).json();
      assert.ok(!listed.some((item: { id: number }) => item.id === row.id));
      const cancelled = await call(`/inventory/purchases/${linked.inventoryPurchaseId}/payment`, "DELETE");
      assert.equal(cancelled.status, 200, await cancelled.text());
      const [released] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, row.id));
      assert.equal(released.journalEntryId, null);
      assert.equal(released.cashTransactionId, null);
      const [journal] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, posted.journalEntryId));
      assert.equal(journal.status, "void");
    });
  }

  it("rolls back supplier, items and completion if custodian validation fails", async () => {
    const row = await bank();
    assert.equal((await call(`/bank-transactions/${row.id}/post-journal`, "POST", { accountId: accounts["1500"] })).status, 200);
    const data = { ...input(), supplierName: `${prefix}-rollback`, responsibleEmployeeId: 2147483647 };
    assert.equal((await call(`/inventory/pending-purchases/${row.id}/register`, "POST", data)).status, 400);
    assert.equal((await db.select().from(inventorySuppliersTable).where(eq(inventorySuppliersTable.name, data.supplierName))).length, 0);
    assert.equal((await db.select().from(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.documentName, data.supplierName))).length, 0);
    assert.ok((await (await call("/inventory/pending-purchases")).json()).some((item: { id: number }) => item.id === row.id));
  });

  it("does not post cash or a journal on a closed cash date", async () => {
    const date = "2098-06-16", row = await bank("1500", date);
    await db.insert(cashClosuresTable).values({ date });
    try {
      assert.equal((await call(`/bank-transactions/${row.id}/post-journal`, "POST", { accountId: accounts["1500"] })).status, 400);
      const [saved] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, row.id));
      assert.equal(saved.cashTransactionId, null);
      assert.equal(saved.journalEntryId, null);
    } finally { await db.delete(cashClosuresTable).where(eq(cashClosuresTable.date, date)); }
  });
});
