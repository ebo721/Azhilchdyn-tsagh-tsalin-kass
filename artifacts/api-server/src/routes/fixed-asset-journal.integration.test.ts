import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import {
  cashTransactionsTable,
  chartOfAccountsTable,
  db,
  fixedAssetsTable,
  journalEntriesTable,
  journalLinesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createStaffSession, hrCookie } from "../lib/hr-session";

describe("fixed asset journal posting", () => {
  let server: Server;
  let baseUrl: string;
  let cookie: string;
  const assetIds: number[] = [];
  const journalIds: number[] = [];
  let fixedAssetAccountId: number;
  let cashAccountId: number;

  before(async () => {
    process.env.SESSION_SECRET = "fixed-asset-journal-test";
    const [admin] = await db.select().from(usersTable).where(eq(usersTable.role, "admin")).limit(1);
    assert.ok(admin);
    cookie = `${hrCookie.name}=${createStaffSession(admin)}`;
    const [fixedAsset] = await db.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.code, "1800"));
    const [cash] = await db.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable)
      .where(eq(chartOfAccountsTable.code, "1000"));
    assert.ok(fixedAsset);
    assert.ok(cash);
    fixedAssetAccountId = fixedAsset.id;
    cashAccountId = cash.id;
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    const reversals = journalIds.length
      ? await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(and(
        eq(journalEntriesTable.sourceType, "reversal"),
        inArray(journalEntriesTable.sourceId, journalIds),
      ))
      : [];
    if (journalIds.length) await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, journalIds));
    if (reversals.length) await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, reversals.map((row) => row.id)));
    if (assetIds.length) {
      await db.delete(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "fixed_asset_purchase"),
        inArray(cashTransactionsTable.sourceKey, assetIds.map((id) => `fixed-asset:${id}`)),
      ));
      await db.delete(fixedAssetsTable).where(inArray(fixedAssetsTable.id, assetIds));
    }
    server.close();
  });

  async function request(path: string, init?: RequestInit) {
    return fetch(`${baseUrl}/api${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json", ...init?.headers },
    });
  }

  async function create(purchased: boolean) {
    const response = await request("/fixed-assets", {
      method: "POST",
      body: JSON.stringify({ name: `Test asset ${Date.now()}`, unitPrice: 125, quantity: 2, date: "2098-01-15", purchased }),
    });
    assert.equal(response.status, 201);
    const value = await response.json() as { id: number };
    assetIds.push(value.id);
    return value.id;
  }

  async function cashFor(assetId: number) {
    const [cash] = await db.select().from(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "fixed_asset_purchase"),
      eq(cashTransactionsTable.sourceKey, `fixed-asset:${assetId}`),
    ));
    assert.ok(cash);
    return cash;
  }

  it("posts a purchased asset with linked balanced journal", async () => {
    const id = await create(true);
    const cash = await cashFor(id);
    assert.ok(cash.journalEntryId);
    journalIds.push(cash.journalEntryId);
    const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, cash.journalEntryId));
    assert.equal(entry?.sourceType, "fixed_asset");
    assert.equal(entry?.sourceId, id);
    assert.equal(entry?.status, "posted");
    const lines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, cash.journalEntryId));
    assert.equal(lines.length, 2);
    assert.equal(lines.find((line) => Number(line.debit) > 0)?.accountId, fixedAssetAccountId);
    assert.equal(lines.find((line) => Number(line.credit) > 0)?.accountId, cashAccountId);
  });

  it("posts false-to-true once and replaces a changed linked purchase", async () => {
    const id = await create(false);
    let response = await request(`/fixed-assets/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "Changed asset", unitPrice: 200, quantity: 2, date: "2098-01-16", purchased: true }),
    });
    assert.equal(response.status, 200);
    let cash = await cashFor(id);
    assert.ok(cash.journalEntryId);
    const firstJournalId = cash.journalEntryId;
    journalIds.push(firstJournalId);
    response = await request(`/fixed-assets/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "Changed asset", unitPrice: 200, quantity: 2, date: "2098-01-16", purchased: true }),
    });
    assert.equal(response.status, 200);
    cash = await cashFor(id);
    assert.equal(cash.journalEntryId, firstJournalId);
    response = await request(`/fixed-assets/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "Changed asset again", unitPrice: 250, quantity: 2, date: "2098-01-17", purchased: true }),
    });
    assert.equal(response.status, 200);
    cash = await cashFor(id);
    assert.notEqual(cash.journalEntryId, firstJournalId);
    journalIds.push(cash.journalEntryId!);
    const [old] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, firstJournalId));
    assert.equal(old?.status, "void");
  });

  it("reverses the journal when purchased status is cleared or the asset is deleted", async () => {
    const id = await create(true);
    let cash = await cashFor(id);
    const firstJournalId = cash.journalEntryId!;
    journalIds.push(firstJournalId);
    let response = await request(`/fixed-assets/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "Unpurchased asset", unitPrice: 125, quantity: 2, date: "2098-01-15", purchased: false }),
    });
    assert.equal(response.status, 200);
    assert.equal((await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cash.id))).length, 0);
    const [voided] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, firstJournalId));
    assert.equal(voided?.status, "void");
    const id2 = await create(true);
    cash = await cashFor(id2);
    journalIds.push(cash.journalEntryId!);
    response = await request(`/fixed-assets/${id2}`, { method: "DELETE" });
    assert.equal(response.status, 204);
    assert.equal((await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cash.id))).length, 0);
  });

  it("rolls back when either canonical posting account is inactive", async () => {
    await db.update(chartOfAccountsTable).set({ isActive: false }).where(eq(chartOfAccountsTable.id, fixedAssetAccountId));
    const response = await request("/fixed-assets", {
      method: "POST",
      body: JSON.stringify({ name: "Rollback fixed asset", unitPrice: 10, quantity: 1, date: "2098-01-20", purchased: true }),
    });
    assert.equal(response.status, 500);
    assert.equal((await db.select().from(fixedAssetsTable).where(eq(fixedAssetsTable.name, "Rollback fixed asset"))).length, 0);
    await db.update(chartOfAccountsTable).set({ isActive: true }).where(eq(chartOfAccountsTable.id, fixedAssetAccountId));
    await db.update(chartOfAccountsTable).set({ isActive: false }).where(eq(chartOfAccountsTable.id, cashAccountId));
    const second = await request("/fixed-assets", {
      method: "POST",
      body: JSON.stringify({ name: "Rollback cash account", unitPrice: 10, quantity: 1, date: "2098-01-21", purchased: true }),
    });
    assert.equal(second.status, 500);
    assert.equal((await db.select().from(fixedAssetsTable).where(eq(fixedAssetsTable.name, "Rollback cash account"))).length, 0);
    await db.update(chartOfAccountsTable).set({ isActive: true }).where(eq(chartOfAccountsTable.id, cashAccountId));
  });
});