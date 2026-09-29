import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import {
  bankTransactionsTable, cashClosuresTable, cashTransactionsTable, chartOfAccountsTable, db,
  fixedAssetsTable, inventoryPurchasePaymentGroupMembersTable, inventoryPurchasePaymentGroupsTable,
  inventoryPurchasesTable, journalEntriesTable, journalLinesTable,
  operatingExpensesTable, usersTable,
} from "@workspace/db";
import app from "../app";
import { createStaffSession, hrCookie } from "../lib/hr-session";

describe("bank document linking", () => {
  let server: Server;
  let baseUrl: string;
  let cookie: string;
  const bankIds: number[] = [];
  const cashIds: number[] = [];
  const purchaseIds: number[] = [];
  const expenseIds: number[] = [];
  const fixedAssetIds: number[] = [];
  const journalIds: number[] = [];
  const paymentGroupIds: number[] = [];
  const closureIds: number[] = [];
  const userIds: number[] = [];
  let accountId: number;

  before(async () => {
    process.env.SESSION_SECRET = "bank-document-linking-test";
    const suffix = `link-${process.pid}-${Date.now()}`;
    const [user] = await db.insert(usersTable).values({
      username: suffix, normalizedUsername: suffix,
      role: "admin", passwordHash: "test",
    }).returning();
    userIds.push(user.id);
    cookie = `${hrCookie.name}=${createStaffSession(user)}`;
    const [account] = await db.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable)
      .where(and(eq(chartOfAccountsTable.type, "expense"), eq(chartOfAccountsTable.isActive, true))).limit(1);
    assert.ok(account);
    accountId = account.id;
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (bankIds.length) await db.update(bankTransactionsTable).set({ cashTransactionId: null, transferredAt: null }).where(inArray(bankTransactionsTable.id, bankIds));
    if (paymentGroupIds.length) {
      await db.delete(inventoryPurchasePaymentGroupMembersTable).where(inArray(inventoryPurchasePaymentGroupMembersTable.groupId, paymentGroupIds));
      await db.delete(inventoryPurchasePaymentGroupsTable).where(inArray(inventoryPurchasePaymentGroupsTable.id, paymentGroupIds));
    }
    if (closureIds.length) await db.delete(cashClosuresTable).where(inArray(cashClosuresTable.id, closureIds));
    if (expenseIds.length) await db.update(operatingExpensesTable).set({ bankTransactionId: null, cashTransactionId: null }).where(inArray(operatingExpensesTable.id, expenseIds));
    if (cashIds.length) await db.delete(cashTransactionsTable).where(inArray(cashTransactionsTable.id, cashIds));
    if (journalIds.length) {
      const reversals = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(and(
        eq(journalEntriesTable.sourceType, "reversal"),
        inArray(journalEntriesTable.sourceId, journalIds),
      ));
      if (reversals.length) await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, reversals.map((row) => row.id)));
      await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, journalIds));
    }
    if (expenseIds.length) await db.delete(operatingExpensesTable).where(inArray(operatingExpensesTable.id, expenseIds));
    if (purchaseIds.length) await db.delete(inventoryPurchasesTable).where(inArray(inventoryPurchasesTable.id, purchaseIds));
    if (fixedAssetIds.length) await db.delete(fixedAssetsTable).where(inArray(fixedAssetsTable.id, fixedAssetIds));
    if (bankIds.length) await db.delete(bankTransactionsTable).where(inArray(bankTransactionsTable.id, bankIds));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  });

  async function bank(date: string, amount: number, label: string) {
    const [row] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date(`${date}T10:00:00Z`), type: "expense", amount,
      description: label, counterparty: label, fingerprint: `link-${label}-${Date.now()}-${Math.random()}`,
    }).returning();
    bankIds.push(row.id);
    return row.id;
  }

  it("posts a journal when linking a legacy cash row that has no journal", async () => {
    const bankId = await bank("2099-08-05", 63_000, "legacy-cash-without-journal");
    const [cash] = await db.insert(cashTransactionsTable).values({
      type: "expense",
      category: "Legacy expense",
      description: "Legacy cash without journal",
      amount: 63_000,
      date: "2099-08-05",
      accountId,
    }).returning();
    cashIds.push(cash.id);
    assert.equal(cash.journalEntryId, null);

    const response = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-cash`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ cashTransactionId: cash.id }),
    });
    assert.equal(response.status, 200);

    const [operatingExpense] = await db.select().from(operatingExpensesTable)
      .where(eq(operatingExpensesTable.cashTransactionId, cash.id));
    assert.ok(operatingExpense);
    expenseIds.push(operatingExpense.id);
    const [linkedCash] = await db.select().from(cashTransactionsTable)
      .where(eq(cashTransactionsTable.id, cash.id));
    assert.ok(linkedCash.journalEntryId);
    journalIds.push(linkedCash.journalEntryId);
    const lines = await db.select().from(journalLinesTable)
      .where(eq(journalLinesTable.journalEntryId, linkedCash.journalEntryId));
    assert.equal(lines.reduce((sum, line) => sum + Number(line.debit), 0), 63_000);
    assert.equal(lines.reduce((sum, line) => sum + Number(line.credit), 0), 63_000);
  });

  it("replaces an existing fixed asset cash journal with one credited to bank", async () => {
    const createResponse = await fetch(`${baseUrl}/api/fixed-assets`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Existing bank-paid asset",
        unitPrice: 150_000,
        quantity: 2,
        date: "2099-08-06",
        purchased: true,
      }),
    });
    assert.equal(createResponse.status, 201);
    const asset = await createResponse.json() as { id: number };
    fixedAssetIds.push(asset.id);
    const [cashBefore] = await db.select().from(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "fixed_asset_purchase"),
      eq(cashTransactionsTable.sourceKey, `fixed-asset:${asset.id}`),
    ));
    assert.ok(cashBefore?.journalEntryId);
    cashIds.push(cashBefore.id);
    journalIds.push(cashBefore.journalEntryId);
    const bankId = await bank("2099-08-06", 300_000, "existing-fixed-asset");

    const response = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-fixed-asset`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ fixedAssetId: asset.id }),
    });
    assert.equal(response.status, 200);
    const result = await response.json() as { cashTransactionId: number; journalEntryId: number };
    assert.equal(result.cashTransactionId, cashBefore.id);
    assert.notEqual(result.journalEntryId, cashBefore.journalEntryId);
    journalIds.push(result.journalEntryId);

    const [oldJournal] = await db.select().from(journalEntriesTable)
      .where(eq(journalEntriesTable.id, cashBefore.journalEntryId));
    assert.equal(oldJournal.status, "void");
    const lines = await db.select({
      code: chartOfAccountsTable.code,
      debit: journalLinesTable.debit,
      credit: journalLinesTable.credit,
    }).from(journalLinesTable)
      .innerJoin(chartOfAccountsTable, eq(chartOfAccountsTable.id, journalLinesTable.accountId))
      .where(eq(journalLinesTable.journalEntryId, result.journalEntryId));
    assert.equal(Number(lines.find((line) => line.code === "1800")?.debit), 300_000);
    assert.equal(Number(lines.find((line) => line.code === "1010")?.credit), 300_000);
    const [linkedCash] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cashBefore.id));
    assert.equal(linkedCash.bankTransactionId, bankId);
    assert.equal(linkedCash.journalEntryId, result.journalEntryId);
    const [linkedBank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    assert.equal(linkedBank.cashTransactionId, cashBefore.id);

    const update = await fetch(`${baseUrl}/api/fixed-assets/${asset.id}`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Changed linked asset",
        unitPrice: 100_000,
        quantity: 3,
        date: "2099-08-06",
        purchased: true,
      }),
    });
    assert.equal(update.status, 200);
    const updatedAsset = await update.json() as { bankTransactionId: number | null; totalAmount: number };
    assert.equal(updatedAsset.bankTransactionId, bankId);
    assert.equal(updatedAsset.totalAmount, 300_000);
    const [cashAfterUpdate] = await db.select().from(cashTransactionsTable)
      .where(eq(cashTransactionsTable.id, cashBefore.id));
    assert.equal(cashAfterUpdate.description, "Changed linked asset (3 ширхэг)");
    assert.equal(cashAfterUpdate.bankTransactionId, bankId);
    assert.notEqual(cashAfterUpdate.journalEntryId, result.journalEntryId);
    assert.ok(cashAfterUpdate.journalEntryId);
    journalIds.push(cashAfterUpdate.journalEntryId);
    const [replacedBankJournal] = await db.select().from(journalEntriesTable)
      .where(eq(journalEntriesTable.id, result.journalEntryId));
    assert.equal(replacedBankJournal.status, "void");
    const updatedLines = await db.select({
      code: chartOfAccountsTable.code,
      debit: journalLinesTable.debit,
      credit: journalLinesTable.credit,
    }).from(journalLinesTable)
      .innerJoin(chartOfAccountsTable, eq(chartOfAccountsTable.id, journalLinesTable.accountId))
      .where(eq(journalLinesTable.journalEntryId, cashAfterUpdate.journalEntryId));
    assert.equal(Number(updatedLines.find((line) => line.code === "1800")?.debit), 300_000);
    assert.equal(Number(updatedLines.find((line) => line.code === "1010")?.credit), 300_000);

    const mismatchedUpdate = await fetch(`${baseUrl}/api/fixed-assets/${asset.id}`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Mismatched linked asset",
        unitPrice: 149_000,
        quantity: 2,
        date: "2099-08-06",
        purchased: true,
      }),
    });
    assert.equal(mismatchedUpdate.status, 409);
    const deletion = await fetch(`${baseUrl}/api/fixed-assets/${asset.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(deletion.status, 409);
    const [stillPosted] = await db.select().from(journalEntriesTable)
      .where(eq(journalEntriesTable.id, cashAfterUpdate.journalEntryId));
    assert.equal(stillPosted.status, "posted");
  });

  it("creates a new fixed asset from a bank transaction without a duplicate cash journal", async () => {
    const bankId = await bank("2099-08-07", 360_000, "new-fixed-asset");
    const response = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-fixed-asset`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "New bank-paid asset",
        unitPrice: 120_000,
        quantity: 3,
        date: "2099-08-07",
      }),
    });
    assert.equal(response.status, 200);
    const result = await response.json() as { fixedAssetId: number; cashTransactionId: number; journalEntryId: number };
    fixedAssetIds.push(result.fixedAssetId);
    cashIds.push(result.cashTransactionId);
    journalIds.push(result.journalEntryId);
    const [asset] = await db.select().from(fixedAssetsTable).where(eq(fixedAssetsTable.id, result.fixedAssetId));
    assert.equal(asset.purchased, true);
    const entries = await db.select().from(journalEntriesTable).where(and(
      eq(journalEntriesTable.sourceType, "fixed_asset"),
      eq(journalEntriesTable.sourceId, result.fixedAssetId),
    ));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, result.journalEntryId);

    const mismatchBankId = await bank("2099-08-08", 50_000, "mismatched-fixed-asset");
    const mismatch = await fetch(`${baseUrl}/api/bank-transactions/${mismatchBankId}/link-fixed-asset`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Mismatch", unitPrice: 49_999, quantity: 1, date: "2099-08-08" }),
    });
    assert.equal(mismatch.status, 400);
    const [unclaimed] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, mismatchBankId));
    assert.equal(unclaimed.cashTransactionId, null);
  });

  it("links an existing unpaid purchase, posts a balanced journal, and removes review row", async () => {
    const [purchase] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food", accountId: (await db.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "1500")))[0].id,
      documentName: "Existing linked purchase", date: "2099-07-23", totalAmount: 42_000,
    }).returning();
    purchaseIds.push(purchase.id);
    const bankId = await bank("2099-08-01", 42_000, "existing-purchase");
    const response = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-purchase`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ inventoryPurchaseId: purchase.id }),
    });
    assert.equal(response.status, 200);
    const result = await response.json() as { cashTransactionId: number; journalEntryId: number };
    cashIds.push(result.cashTransactionId); journalIds.push(result.journalEntryId);
    const [saved] = await db.select().from(inventoryPurchasesTable).where(eq(inventoryPurchasesTable.id, purchase.id));
    assert.equal(saved.date, "2099-07-23");
    assert.equal(saved.paymentDate, "2099-08-01"); assert.equal(Number(saved.paymentAmount), 42_000);
    const [linked] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    assert.equal(linked.cashTransactionId, result.cashTransactionId); assert.ok(linked.transferredAt);
    const lines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, result.journalEntryId));
    assert.equal(lines.reduce((sum, line) => sum + Number(line.debit), 0), 42_000);
    assert.equal(lines.reduce((sum, line) => sum + Number(line.credit), 0), 42_000);
    const review = await fetch(`${baseUrl}/api/bank-transactions/journal-review`, { headers: { cookie } });
    assert.equal((await review.json() as Array<{ id: number }>).some((row) => row.id === bankId), false);
    assert.equal((await fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-purchase`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ inventoryPurchaseId: purchase.id }) })).status, 409);
  });

  it("links distinct unpaid purchases as one atomic bank payment and cancels the group atomically", async () => {
    const [inventoryAccount] = await db.select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "1500"));
    assert.ok(inventoryAccount);
    const [first] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food", accountId: inventoryAccount.id, documentName: "Grouped purchase A",
      date: "2099-07-31", totalAmount: 42_000,
    }).returning();
    const [second] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food", accountId: inventoryAccount.id, documentName: "Grouped purchase B",
      date: "2099-08-04", totalAmount: 18_000,
    }).returning();
    purchaseIds.push(first.id, second.id);
    const bankId = await bank("2099-08-09", 60_000, "grouped-purchases");
    const response = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-purchases`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ inventoryPurchaseIds: [second.id, first.id] }),
    });
    assert.equal(response.status, 200);
    const result = await response.json() as {
      bankTransactionId: number; inventoryPurchaseIds: number[]; cashTransactionId: number; journalEntryId: number;
    };
    assert.deepEqual(result.inventoryPurchaseIds, [first.id, second.id]);
    cashIds.push(result.cashTransactionId);
    journalIds.push(result.journalEntryId);
    const [cash] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, result.cashTransactionId));
    assert.equal(cash.amount, 60_000);
    assert.equal(cash.date, "2099-08-09");
    assert.equal(cash.sourceType, "inventory_purchase_group");
    const cashListResponse = await fetch(`${baseUrl}/api/cash/transactions`, { headers: { cookie } });
    assert.equal(cashListResponse.status, 200);
    const cashRows = await cashListResponse.json() as Array<{ id: number; transactionKind: string }>;
    assert.equal(cashRows.find((row) => row.id === result.cashTransactionId)?.transactionKind, "inventory_purchase_group");
    const entries = await db.select().from(journalEntriesTable)
      .where(eq(journalEntriesTable.id, result.journalEntryId));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].date, "2099-08-09");
    const lines = await db.select({
      accountId: journalLinesTable.accountId,
      debit: journalLinesTable.debit,
      credit: journalLinesTable.credit,
    }).from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, result.journalEntryId));
    assert.equal(lines.length, 3);
    const debitLines = lines.filter((line) => Number(line.debit) > 0);
    assert.deepEqual(debitLines.map((line) => Number(line.debit)), [42_000, 18_000]);
    assert.deepEqual(debitLines.map((line) => line.accountId), [inventoryAccount.id, inventoryAccount.id]);
    const [bankAccount] = await db.select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "1010"));
    assert.deepEqual(lines.filter((line) => Number(line.credit) > 0).map((line) => line.accountId), [bankAccount.id]);
    assert.equal(lines.reduce((sum, line) => sum + Number(line.debit), 0), 60_000);
    assert.equal(lines.reduce((sum, line) => sum + Number(line.credit), 0), 60_000);
    const [claimedBank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    assert.equal(claimedBank.cashTransactionId, result.cashTransactionId);
    assert.equal(claimedBank.journalEntryId, result.journalEntryId);
    const paidPurchases = await db.select().from(inventoryPurchasesTable)
      .where(inArray(inventoryPurchasesTable.id, [first.id, second.id]))
      .orderBy(inventoryPurchasesTable.id);
    assert.deepEqual(paidPurchases.map((purchase) => [purchase.date, purchase.paymentDate, Number(purchase.paymentAmount)]), [
      ["2099-07-31", "2099-08-09", 42_000], ["2099-08-04", "2099-08-09", 18_000],
    ]);
    const members = await db.select().from(inventoryPurchasePaymentGroupMembersTable)
      .where(inArray(inventoryPurchasePaymentGroupMembersTable.purchaseId, [first.id, second.id]));
    assert.equal(members.length, 2);
    const [group] = await db.select().from(inventoryPurchasePaymentGroupsTable)
      .where(eq(inventoryPurchasePaymentGroupsTable.bankTransactionId, bankId));
    paymentGroupIds.push(group.id);
    const purchaseList = await fetch(`${baseUrl}/api/inventory/purchases`, { headers: { cookie } });
    const purchaseRows = await purchaseList.json() as Array<{ id: number; paymentGroupBankTransactionId: number | null }>;
    assert.equal(purchaseRows.find((purchase) => purchase.id === first.id)?.paymentGroupBankTransactionId, bankId);
    assert.equal(purchaseRows.find((purchase) => purchase.id === second.id)?.paymentGroupBankTransactionId, bankId);
    const protectedEdit = await fetch(`${baseUrl}/api/inventory/purchases/${first.id}`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        materialType: "food", supplierName: "Changed supplier", hasReceipt: false, date: "2099-08-09",
        items: [{ name: "Changed item", category: "Food", unit: "ширхэг", quantity: 1, unitPrice: 42_000 }],
      }),
    });
    assert.equal(protectedEdit.status, 409);
    const protectedReclassification = await fetch(`${baseUrl}/api/inventory/purchases/${second.id}/reclassify-as-expense`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ accountId }),
    });
    assert.equal(protectedReclassification.status, 409);
    const protectedJournalUnlink = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/journal`, {
      method: "DELETE", headers: { cookie },
    });
    assert.equal(protectedJournalUnlink.status, 409);
    const [closure] = await db.insert(cashClosuresTable).values({ date: "2099-08-09" }).returning();
    closureIds.push(closure.id);
    const blockedCancel = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/purchase-group`, {
      method: "DELETE", headers: { cookie },
    });
    assert.equal(blockedCancel.status, 409);
    const [stillActiveGroup] = await db.select().from(inventoryPurchasePaymentGroupsTable)
      .where(eq(inventoryPurchasePaymentGroupsTable.id, group.id));
    assert.equal(stillActiveGroup.status, "active");
    await db.delete(cashClosuresTable).where(eq(cashClosuresTable.id, closure.id));
    closureIds.splice(closureIds.indexOf(closure.id), 1);
    await db.update(inventoryPurchasesTable).set({ paymentAmount: 41_999 }).where(eq(inventoryPurchasesTable.id, first.id));
    const inconsistentPurchaseCancel = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/purchase-group`, {
      method: "DELETE", headers: { cookie },
    });
    assert.equal(inconsistentPurchaseCancel.status, 409);
    await db.update(inventoryPurchasesTable).set({ paymentAmount: 42_000 }).where(eq(inventoryPurchasesTable.id, first.id));
    await db.update(cashTransactionsTable).set({ amount: 60_001 }).where(eq(cashTransactionsTable.id, result.cashTransactionId));
    const inconsistentCashCancel = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/purchase-group`, {
      method: "DELETE", headers: { cookie },
    });
    assert.equal(inconsistentCashCancel.status, 409);
    await db.update(cashTransactionsTable).set({ amount: 60_000 }).where(eq(cashTransactionsTable.id, result.cashTransactionId));
    await db.update(journalEntriesTable).set({ status: "void" }).where(eq(journalEntriesTable.id, result.journalEntryId));
    const inconsistentJournalCancel = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/purchase-group`, {
      method: "DELETE", headers: { cookie },
    });
    assert.equal(inconsistentJournalCancel.status, 409);
    await db.update(journalEntriesTable).set({ status: "posted" }).where(eq(journalEntriesTable.id, result.journalEntryId));

    const individualCancel = await fetch(`${baseUrl}/api/inventory/purchases/${first.id}/payment`, {
      method: "DELETE", headers: { cookie },
    });
    assert.equal(individualCancel.status, 409);
    const individualDelete = await fetch(`${baseUrl}/api/inventory/purchases/${second.id}`, {
      method: "DELETE", headers: { cookie },
    });
    assert.equal(individualDelete.status, 409);

    const cancel = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/purchase-group`, {
      method: "DELETE", headers: { cookie },
    });
    assert.equal(cancel.status, 200);
    const cancelled = await cancel.json() as { inventoryPurchaseIds: number[]; cancelled: boolean };
    assert.deepEqual(cancelled.inventoryPurchaseIds, [first.id, second.id]);
    assert.equal(cancelled.cancelled, true);
    const [cancelledGroup] = await db.select().from(inventoryPurchasePaymentGroupsTable)
      .where(eq(inventoryPurchasePaymentGroupsTable.id, group.id));
    assert.equal(cancelledGroup.status, "cancelled");
    assert.ok(cancelledGroup.cancelledAt);
    const savedPurchases = await db.select().from(inventoryPurchasesTable)
      .where(inArray(inventoryPurchasesTable.id, [first.id, second.id]));
    assert.ok(savedPurchases.every((purchase) => purchase.paymentDate === null && purchase.paymentAmount === null));
    const purchaseListAfterCancel = await fetch(`${baseUrl}/api/inventory/purchases`, { headers: { cookie } });
    const rowsAfterCancel = await purchaseListAfterCancel.json() as Array<{ id: number; paymentGroupBankTransactionId: number | null }>;
    assert.equal(rowsAfterCancel.find((purchase) => purchase.id === first.id)?.paymentGroupBankTransactionId, null);
    const historicalMembers = await db.select().from(inventoryPurchasePaymentGroupMembersTable)
      .where(eq(inventoryPurchasePaymentGroupMembersTable.groupId, group.id));
    assert.equal(historicalMembers.length, 2);
    const deleteAfterCancel = await fetch(`${baseUrl}/api/inventory/purchases/${first.id}`, {
      method: "DELETE", headers: { cookie },
    });
    assert.equal(deleteAfterCancel.status, 204);
    const [unlinkedBank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    assert.equal(unlinkedBank.cashTransactionId, null);
    assert.equal(unlinkedBank.journalEntryId, null);
    const [voidedEntry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, result.journalEntryId));
    assert.equal(voidedEntry.status, "void");
    const reversal = await db.select().from(journalEntriesTable).where(and(
      eq(journalEntriesTable.sourceType, "reversal"),
      eq(journalEntriesTable.sourceId, result.journalEntryId),
    ));
    assert.equal(reversal.length, 1);
    journalIds.push(reversal[0].id);
  });

  it("rejects mismatched grouped totals without leaving a bank claim or partial accounting rows", async () => {
    const [inventoryAccount] = await db.select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "1500"));
    assert.ok(inventoryAccount);
    const [first] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food", accountId: inventoryAccount.id, documentName: "Mismatch group A",
      date: "2099-08-10", totalAmount: 4_000,
    }).returning();
    const [second] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food", accountId: inventoryAccount.id, documentName: "Mismatch group B",
      date: "2099-08-10", totalAmount: 5_000,
    }).returning();
    purchaseIds.push(first.id, second.id);
    const bankId = await bank("2099-08-10", 10_000, "mismatched-purchase-group");
    const duplicate = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-purchases`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ inventoryPurchaseIds: [first.id, first.id] }),
    });
    assert.equal(duplicate.status, 400);
    const response = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-purchases`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ inventoryPurchaseIds: [first.id, second.id] }),
    });
    assert.equal(response.status, 409);
    const [unclaimed] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    assert.equal(unclaimed.cashTransactionId, null);
    assert.equal(unclaimed.transferredAt, null);
    assert.equal((await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.bankTransactionId, bankId))).length, 0);
    assert.equal((await db.select().from(inventoryPurchasePaymentGroupsTable)
      .where(eq(inventoryPurchasePaymentGroupsTable.bankTransactionId, bankId))).length, 0);
    assert.equal((await db.select().from(journalEntriesTable).where(and(
      eq(journalEntriesTable.sourceType, "inventory_purchase_group"),
      eq(journalEntriesTable.sourceId, bankId),
    ))).length, 0);
  });

  it("rejects a purchase dated after the bank payment in single and grouped links", async () => {
    const [inventoryAccount] = await db.select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "1500"));
    assert.ok(inventoryAccount);
    const [futurePurchase] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food", accountId: inventoryAccount.id, documentName: "Future purchase",
      date: "2099-08-16", totalAmount: 6_000,
    }).returning();
    const [earlierPurchase] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food", accountId: inventoryAccount.id, documentName: "Earlier purchase",
      date: "2099-08-12", totalAmount: 4_000,
    }).returning();
    purchaseIds.push(futurePurchase.id, earlierPurchase.id);
    const singleBankId = await bank("2099-08-15", 6_000, "future-single-purchase");
    const groupBankId = await bank("2099-08-15", 10_000, "future-group-purchase");
    const headers = { cookie, "content-type": "application/json" };
    const single = await fetch(`${baseUrl}/api/bank-transactions/${singleBankId}/link-purchase`, {
      method: "POST", headers,
      body: JSON.stringify({ inventoryPurchaseId: futurePurchase.id }),
    });
    assert.equal(single.status, 409);
    const group = await fetch(`${baseUrl}/api/bank-transactions/${groupBankId}/link-purchases`, {
      method: "POST", headers,
      body: JSON.stringify({ inventoryPurchaseIds: [earlierPurchase.id, futurePurchase.id] }),
    });
    assert.equal(group.status, 409);
    const unclaimedBanks = await db.select().from(bankTransactionsTable)
      .where(inArray(bankTransactionsTable.id, [singleBankId, groupBankId]));
    assert.ok(unclaimedBanks.every((row) => row.cashTransactionId === null && row.transferredAt === null));
    const untouchedPurchases = await db.select().from(inventoryPurchasesTable)
      .where(inArray(inventoryPurchasesTable.id, [futurePurchase.id, earlierPurchase.id]));
    assert.ok(untouchedPurchases.every((row) => row.paymentDate === null && row.paymentAmount === null));
    assert.equal((await db.select().from(cashTransactionsTable)
      .where(inArray(cashTransactionsTable.bankTransactionId, [singleBankId, groupBankId]))).length, 0);
  });

  it("serializes grouped bank linking against the existing single-purchase payment path", async () => {
    const [inventoryAccount] = await db.select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "1500"));
    assert.ok(inventoryAccount);
    const [first] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food", accountId: inventoryAccount.id, documentName: "Racing purchase A",
      date: "2099-08-11", totalAmount: 12_000,
    }).returning();
    const [second] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food", accountId: inventoryAccount.id, documentName: "Racing purchase B",
      date: "2099-08-11", totalAmount: 20_000,
    }).returning();
    purchaseIds.push(first.id, second.id);
    const bankId = await bank("2099-08-11", 32_000, "racing-purchase-group");
    const headers = { cookie, "content-type": "application/json" };
    const [groupResponse, singleResponse] = await Promise.all([
      fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-purchases`, {
        method: "POST",
        headers,
        body: JSON.stringify({ inventoryPurchaseIds: [first.id, second.id] }),
      }),
      fetch(`${baseUrl}/api/inventory/purchases/${first.id}/payment`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ date: "2099-08-11", amount: 12_000 }),
      }),
    ]);
    assert.deepEqual([groupResponse.status, singleResponse.status].sort(), [200, 409]);
    if (groupResponse.status === 200) {
      const result = await groupResponse.json() as { cashTransactionId: number; journalEntryId: number };
      cashIds.push(result.cashTransactionId);
      journalIds.push(result.journalEntryId);
      const [group] = await db.select().from(inventoryPurchasePaymentGroupsTable)
        .where(eq(inventoryPurchasePaymentGroupsTable.bankTransactionId, bankId));
      paymentGroupIds.push(group.id);
    } else {
      const [cash] = await db.select().from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "inventory_purchase"),
        eq(cashTransactionsTable.sourceKey, `purchase:${first.id}`),
      ));
      assert.ok(cash?.journalEntryId);
      cashIds.push(cash.id);
      journalIds.push(cash.journalEntryId);
    }
    const [bankAfter] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    if (groupResponse.status === 200) {
      assert.ok(bankAfter.cashTransactionId);
      assert.equal(bankAfter.amount, 32_000);
    } else {
      assert.equal(bankAfter.cashTransactionId, null);
    }
  });

  it("serializes reverse and forward linking without a deadlock or duplicate journal", async () => {
    const [inventoryAccount] = await db.select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.code, "1500"));
    assert.ok(inventoryAccount);
    const [purchase] = await db.insert(inventoryPurchasesTable).values({
      materialType: "food",
      accountId: inventoryAccount.id,
      documentName: "Concurrent linked purchase",
      date: "2099-08-04",
      totalAmount: 27_000,
    }).returning();
    purchaseIds.push(purchase.id);
    const bankId = await bank("2099-08-04", 27_000, "concurrent-purchase");
    const headers = { cookie, "content-type": "application/json" };
    const [forward, reverse] = await Promise.all([
      fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-purchase`, {
        method: "POST",
        headers,
        body: JSON.stringify({ inventoryPurchaseId: purchase.id }),
      }),
      fetch(`${baseUrl}/api/inventory/purchases/${purchase.id}/payment`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ date: "2099-08-04", amount: 27_000, bankTransactionId: bankId }),
      }),
    ]);
    assert.deepEqual([forward.status, reverse.status].sort(), [200, 409]);
    const cashRows = await db.select().from(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "inventory_purchase"),
      eq(cashTransactionsTable.sourceKey, `purchase:${purchase.id}`),
    ));
    assert.equal(cashRows.length, 1);
    cashIds.push(cashRows[0].id);
    assert.ok(cashRows[0].journalEntryId);
    journalIds.push(cashRows[0].journalEntryId!);
  });

  it("creates and links a new operating expense atomically", async () => {
    const bankId = await bank("2099-08-02", 31_000, "new-operating-expense");
    const response = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-expense`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ description: "New linked operating expense", accountId, date: "2099-08-02", amount: 31_000 }),
    });
    assert.equal(response.status, 200);
    const result = await response.json() as { operatingExpenseId: number; cashTransactionId: number; journalEntryId: number };
    expenseIds.push(result.operatingExpenseId); cashIds.push(result.cashTransactionId); journalIds.push(result.journalEntryId);
    const [expense] = await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.id, result.operatingExpenseId));
    assert.equal(expense.paymentDate, "2099-08-02"); assert.equal(expense.bankTransactionId, bankId); assert.equal(expense.cashTransactionId, result.cashTransactionId);
    const [cash] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, result.cashTransactionId));
    assert.equal(cash.bankTransactionId, bankId); assert.ok(cash.journalEntryId);
  });

  it("rolls back a mismatched new expense without claiming the bank", async () => {
    const bankId = await bank("2099-08-03", 19_000, "mismatch");
    const response = await fetch(`${baseUrl}/api/bank-transactions/${bankId}/link-expense`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ description: "Should roll back", accountId, date: "2099-08-03", amount: 18_999 }),
    });
    assert.equal(response.status, 400);
    const [linked] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    assert.equal(linked.cashTransactionId, null); assert.equal(linked.transferredAt, null);
    assert.equal((await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.description, "Should roll back"))).length, 0);
    assert.equal((await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.bankTransactionId, bankId))).length, 0);
    assert.equal((await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.description, "Should roll back"))).length, 0);
  });
});