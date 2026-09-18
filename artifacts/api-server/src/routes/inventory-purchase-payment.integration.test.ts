import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  cashTransactionsTable,
  bankTransactionsTable,
  db,
  inventoryPurchasesTable,
  chartOfAccountsTable,
  journalEntriesTable,
  journalLinesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createStaffSession, hrCookie } from "../lib/hr-session";

describe("inventory purchase payment", () => {
  let server: Server;
  let baseUrl: string;
  let adminCookie: string;
  let purchaseId: number;
  let bankTransactionId: number;
  let journalEntryIds: number[] = [];
  let inventoryAccountId: number;

  before(async () => {
    process.env.SESSION_SECRET = "inventory-purchase-payment-test";
    const [admin] = await db.select().from(usersTable).where(eq(usersTable.role, "admin")).limit(1);
    assert.ok(admin, "An admin database user is required for the integration test");
    adminCookie = `${hrCookie.name}=${createStaffSession(admin)}`;
    const [inventoryAccount] = await db.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "1500"));
    assert.ok(inventoryAccount);
    inventoryAccountId = inventoryAccount.id;
    const [purchase] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food",
      documentName: `Payment test ${process.pid}`,
      hasReceipt: true,
      date: "2099-01-10",
      totalAmount: 125_000,
      accountId: inventoryAccountId,
    }).returning({ id: inventoryPurchasesTable.id });
    purchaseId = purchase.id;
    const [bankTransaction] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date("2099-01-15T09:30:00.000Z"),
      type: "expense",
      amount: 120_000,
      account: "1234567890",
      counterparty: `Payment test ${process.pid}`,
      description: `Payment test ${process.pid} бараа материал`,
      fingerprint: `inventory-payment-bank-${process.pid}`,
    }).returning({ id: bankTransactionsTable.id });
    bankTransactionId = bankTransaction.id;
    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await db.delete(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "inventory_purchase"),
      eq(cashTransactionsTable.sourceKey, `purchase:${purchaseId}`),
    ));
    if (journalEntryIds.length) {
      const reversalIds = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(and(
        eq(journalEntriesTable.sourceType, "reversal"),
        inArray(journalEntriesTable.sourceId, journalEntryIds),
      ));
      await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, journalEntryIds));
      if (reversalIds.length) {
        await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, reversalIds.map((row) => row.id)));
      }
    }
    await db.delete(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankTransactionId));
    await db.delete(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, purchaseId));
    server.close();
  });

  it("suggests, links, and releases a bank transaction with the cash expense", async () => {
    const suggestionsResponse = await fetch(`${baseUrl}/api/inventory/purchases/${purchaseId}/payment-bank-suggestions`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(suggestionsResponse.status, 200);
    const suggestions = await suggestionsResponse.json() as Array<{ id: number; score: number }>;
    assert.equal(suggestions[0]?.id, bankTransactionId);
    assert.ok((suggestions[0]?.score ?? 0) > 0);

    const confirmResponse = await fetch(`${baseUrl}/api/inventory/purchases/${purchaseId}/payment`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ date: "2099-01-15", amount: 120_000, bankTransactionId }),
    });
    assert.equal(confirmResponse.status, 200);
    const confirmed = await confirmResponse.json() as { paid: boolean; paymentDate: string; paymentAmount: number };
    assert.equal(confirmed.paid, true);
    assert.equal(confirmed.paymentDate, "2099-01-15");
    assert.equal(confirmed.paymentAmount, 120_000);

    const [cashExpense] = await db.select().from(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "inventory_purchase"),
      eq(cashTransactionsTable.sourceKey, `purchase:${purchaseId}`),
    ));
    assert.ok(cashExpense);
    assert.equal(cashExpense.date, "2099-01-15");
    assert.equal(cashExpense.category, "Хүнсний бараа материал");
    assert.equal(Number(cashExpense.amount), 120_000);
    assert.equal(cashExpense.bankTransactionId, bankTransactionId);
    assert.ok(cashExpense.bankVerifiedAt);
    assert.ok(cashExpense.journalEntryId);
    journalEntryIds.push(cashExpense.journalEntryId);
    const [journal] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, cashExpense.journalEntryId));
    assert.equal(journal?.sourceType, "inventory_purchase");
    assert.equal(journal?.sourceId, purchaseId);
    assert.equal(journal?.status, "posted");
    const lines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, cashExpense.journalEntryId));
    assert.equal(lines.length, 2);
    const [inventoryAccount] = await db.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "1500"));
    const [bankAccount] = await db.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "1010"));
    assert.equal(lines.find((line) => Number(line.debit) > 0)?.accountId, inventoryAccount?.id);
    assert.equal(lines.find((line) => Number(line.credit) > 0)?.accountId, bankAccount?.id);
    const [linkedBank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankTransactionId));
    assert.equal(linkedBank?.cashTransactionId, cashExpense.id);
    assert.ok(linkedBank?.transferredAt);

    const reconfirmResponse = await fetch(`${baseUrl}/api/inventory/purchases/${purchaseId}/payment`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ date: "2099-01-16", amount: 110_000 }),
    });
    assert.equal(reconfirmResponse.status, 409);

    const cancelResponse = await fetch(`${baseUrl}/api/inventory/purchases/${purchaseId}/payment`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    assert.equal(cancelResponse.status, 200);
    const cancelled = await cancelResponse.json() as { paid: boolean; paymentDate: null; paymentAmount: null };
    assert.equal(cancelled.paid, false);
    assert.equal(cancelled.paymentDate, null);
    assert.equal(cancelled.paymentAmount, null);

    const [removedCashExpense] = await db.select().from(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "inventory_purchase"),
      eq(cashTransactionsTable.sourceKey, `purchase:${purchaseId}`),
    ));
    assert.equal(removedCashExpense, undefined);
    const [reversal] = await db.select().from(journalEntriesTable).where(and(
      eq(journalEntriesTable.sourceType, "reversal"),
      eq(journalEntriesTable.sourceId, cashExpense.journalEntryId),
    ));
    assert.equal(reversal?.status, "posted");
    const [releasedBank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankTransactionId));
    assert.equal(releasedBank?.cashTransactionId, null);
    assert.equal(releasedBank?.transferredAt, null);

    const relinkResponse = await fetch(`${baseUrl}/api/inventory/purchases/${purchaseId}/payment`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ date: "2099-01-15", amount: 120_000, bankTransactionId }),
    });
    assert.equal(relinkResponse.status, 200);
    const [relinkedCash] = await db.select().from(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "inventory_purchase"),
      eq(cashTransactionsTable.sourceKey, `purchase:${purchaseId}`),
    ));
    assert.ok(relinkedCash?.journalEntryId);
    if (relinkedCash?.journalEntryId) journalEntryIds.push(relinkedCash.journalEntryId);
    const deleteResponse = await fetch(`${baseUrl}/api/inventory/purchases/${purchaseId}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    assert.equal(deleteResponse.status, 204);
    const [releasedAfterDelete] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankTransactionId));
    assert.equal(releasedAfterDelete?.cashTransactionId, null);
    assert.equal(releasedAfterDelete?.transferredAt, null);
  });

  it("allows only one purchase to claim the same bank transaction concurrently", async () => {
    const purchases = await db.insert(inventoryPurchasesTable).values([
      { documentName: `Concurrent payment A ${process.pid}`, hasReceipt: true, date: "2099-02-10", totalAmount: 50_000, accountId: inventoryAccountId },
      { documentName: `Concurrent payment B ${process.pid}`, hasReceipt: true, date: "2099-02-10", totalAmount: 50_000, accountId: inventoryAccountId },
    ]).returning({ id: inventoryPurchasesTable.id });
    const purchaseIds = purchases.map((purchase) => purchase.id);
    const [bank] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date("2099-02-11T10:00:00.000Z"),
      type: "expense",
      amount: 50_000,
      description: `Concurrent payment ${process.pid}`,
      fingerprint: `inventory-payment-concurrent-${process.pid}`,
    }).returning({ id: bankTransactionsTable.id });
    try {
      const responses = await Promise.all(purchaseIds.map((id) => fetch(`${baseUrl}/api/inventory/purchases/${id}/payment`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ date: "2099-02-11", amount: 50_000, bankTransactionId: bank.id }),
      })));
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
      const linkedCash = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.bankTransactionId, bank.id));
      assert.equal(linkedCash.length, 1);
    } finally {
      await db.update(bankTransactionsTable).set({ cashTransactionId: null, transferredAt: null }).where(eq(bankTransactionsTable.id, bank.id));
      await db.delete(cashTransactionsTable).where(eq(cashTransactionsTable.bankTransactionId, bank.id));
      await db.delete(inventoryPurchasesTable).where(inArray(inventoryPurchasesTable.id, purchaseIds));
      await db.delete(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id));
    }
  });

  it("posts cash payments and rolls back when the cash account is inactive", async () => {
    const [purchase] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food",
      documentName: `Cash payment ${process.pid}`,
      hasReceipt: true,
      date: "2099-03-10",
      totalAmount: 25_000,
      accountId: inventoryAccountId,
    }).returning({ id: inventoryPurchasesTable.id });
    const [cashPayment] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food",
      documentName: `Cash rollback ${process.pid}`,
      hasReceipt: true,
      date: "2099-03-11",
      totalAmount: 26_000,
      accountId: inventoryAccountId,
    }).returning({ id: inventoryPurchasesTable.id });
    const [cashAccount] = await db.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "1000"));
    assert.ok(cashAccount);
    try {
      const paid = await fetch(`${baseUrl}/api/inventory/purchases/${purchase.id}/payment`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ date: "2099-03-10", amount: 25_000 }),
      });
      assert.equal(paid.status, 200);
      const [cash] = await db.select().from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "inventory_purchase"),
        eq(cashTransactionsTable.sourceKey, `purchase:${purchase.id}`),
      ));
      assert.ok(cash?.journalEntryId);
      const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, cash.journalEntryId!));
      assert.equal(entry?.sourceType, "inventory_purchase");
      const [cashLine] = await db.select().from(journalLinesTable).where(and(
        eq(journalLinesTable.journalEntryId, cash.journalEntryId!),
        eq(journalLinesTable.accountId, cashAccount.id),
      ));
      assert.equal(Number(cashLine?.credit), 25_000);

      await db.update(chartOfAccountsTable).set({ isActive: false }).where(eq(chartOfAccountsTable.id, cashAccount.id));
      const rolledBack = await fetch(`${baseUrl}/api/inventory/purchases/${cashPayment.id}/payment`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ date: "2099-03-11", amount: 26_000 }),
      });
      assert.equal(rolledBack.status, 500);
      const [unpaid] = await db.select().from(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, cashPayment.id));
      assert.equal(unpaid?.paymentDate, null);
      const [rolledCash] = await db.select().from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "inventory_purchase"),
        eq(cashTransactionsTable.sourceKey, `purchase:${cashPayment.id}`),
      ));
      assert.equal(rolledCash, undefined);
      await db.update(chartOfAccountsTable).set({ isActive: true }).where(eq(chartOfAccountsTable.id, cashAccount.id));

      const cancelled = await fetch(`${baseUrl}/api/inventory/purchases/${purchase.id}/payment`, {
        method: "DELETE",
        headers: { cookie: adminCookie },
      });
      assert.equal(cancelled.status, 200);
    } finally {
      await db.update(chartOfAccountsTable).set({ isActive: true }).where(eq(chartOfAccountsTable.id, cashAccount.id));
      const sourceEntries = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(and(
        eq(journalEntriesTable.sourceType, "inventory_purchase"),
        inArray(journalEntriesTable.sourceId, [purchase.id, cashPayment.id]),
      ));
      const reversalEntries = sourceEntries.length
        ? await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(and(
          eq(journalEntriesTable.sourceType, "reversal"),
          inArray(journalEntriesTable.sourceId, sourceEntries.map((row) => row.id)),
        ))
        : [];
      if (sourceEntries.length) await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, sourceEntries.map((row) => row.id)));
      if (reversalEntries.length) await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, reversalEntries.map((row) => row.id)));
      await db.delete(cashTransactionsTable).where(inArray(cashTransactionsTable.sourceKey, [`purchase:${purchase.id}`, `purchase:${cashPayment.id}`]));
      await db.delete(inventoryPurchasesTable).where(inArray(inventoryPurchasesTable.id, [purchase.id, cashPayment.id]));
    }
  });
});