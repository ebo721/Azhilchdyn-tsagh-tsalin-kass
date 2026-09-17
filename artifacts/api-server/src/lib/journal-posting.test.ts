import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { chartOfAccountsTable, db, journalEntriesTable, journalLinesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { postJournalEntry, voidJournalEntry } from "./journal-posting";

describe("journal posting", () => {
  const accountIds: number[] = [];
  const entryIds: number[] = [];
  let debitAccountId: number;
  let creditAccountId: number;
  let inactiveAccountId: number;

  before(async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const accounts = await db.insert(chartOfAccountsTable).values([
      { code: `test-debit-${suffix}`, name: "Journal test debit", type: "asset", normalBalance: "debit" },
      { code: `test-credit-${suffix}`, name: "Journal test credit", type: "liability", normalBalance: "credit" },
      { code: `test-inactive-${suffix}`, name: "Journal test inactive", type: "expense", normalBalance: "debit", isActive: false },
    ]).returning({ id: chartOfAccountsTable.id });
    [debitAccountId, creditAccountId, inactiveAccountId] = accounts.map(({ id }) => id);
    accountIds.push(...accounts.map(({ id }) => id));
  });

  after(async () => {
    if (entryIds.length) {
      await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, entryIds));
    }
    if (accountIds.length) {
      await db.delete(chartOfAccountsTable).where(inArray(chartOfAccountsTable.id, accountIds));
    }
  });

  const post = (lines: Array<{ accountId: number; debit: number; credit: number }>) =>
    db.transaction((tx) => postJournalEntry(tx, {
      date: "2099-01-01",
      description: "Journal posting test",
      sourceType: "manual",
      sourceId: null,
      createdBy: null,
      lines,
    }));

  it("posts a balanced entry", async () => {
    const result = await post([
      { accountId: debitAccountId, debit: 100.1, credit: 0 },
      { accountId: creditAccountId, debit: 0, credit: 100.1 },
    ]);
    entryIds.push(result.journalEntryId);
    assert.equal(result.status, "posted");
  });

  it("keeps an unbalanced entry as draft", async () => {
    const result = await post([
      { accountId: debitAccountId, debit: 100, credit: 0 },
      { accountId: creditAccountId, debit: 0, credit: 99.99 },
    ]);
    entryIds.push(result.journalEntryId);
    assert.equal(result.status, "draft");
  });

  it("normalizes amounts to cents before balancing and persistence", async () => {
    const result = await post([
      { accountId: debitAccountId, debit: 1.005, credit: 0 },
      { accountId: creditAccountId, debit: 0, credit: 1.004999 },
    ]);
    entryIds.push(result.journalEntryId);
    const lines = await db.select().from(journalLinesTable)
      .where(eq(journalLinesTable.journalEntryId, result.journalEntryId))
      .orderBy(journalLinesTable.id);
    assert.equal(result.status, "posted");
    assert.equal(lines[0].debit, lines[1].credit);
  });

  it("keeps a one-cent mismatch when aggregate cents exceed Number.MAX_SAFE_INTEGER", async () => {
    const amount = 999_999_999_999.99;
    const debitLines = Array.from({ length: 91 }, () => ({ accountId: debitAccountId, debit: amount, credit: 0 }));
    const creditLines = Array.from({ length: 91 }, (_, index) => ({
      accountId: creditAccountId,
      debit: 0,
      credit: index === 90 ? amount - 0.01 : amount,
    }));
    const result = await post([...debitLines, ...creditLines]);
    entryIds.push(result.journalEntryId);
    assert.equal(result.status, "draft");
  });

  it("rejects a one-line entry", async () => {
    await assert.rejects(() => post([
      { accountId: debitAccountId, debit: 100, credit: 0 },
    ]), /at least two lines/);
  });

  it("rejects an inactive account", async () => {
    await assert.rejects(() => post([
      { accountId: inactiveAccountId, debit: 100, credit: 0 },
      { accountId: creditAccountId, debit: 0, credit: 100 },
    ]), /active account/);
  });

  it("voids the original and creates an opposite posted reversal", async () => {
    const original = await post([
      { accountId: debitAccountId, debit: 125.25, credit: 0 },
      { accountId: creditAccountId, debit: 0, credit: 125.25 },
    ]);
    entryIds.push(original.journalEntryId);

    const result = await db.transaction((tx) => voidJournalEntry(tx, {
      journalEntryId: original.journalEntryId,
      voidedBy: null,
    }));
    entryIds.push(result.reversalEntryId);

    const [originalEntry, reversalEntry, originalLines, reversalLines] = await Promise.all([
      db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, original.journalEntryId)).then(([row]) => row),
      db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, result.reversalEntryId)).then(([row]) => row),
      db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, original.journalEntryId)).orderBy(journalLinesTable.id),
      db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, result.reversalEntryId)).orderBy(journalLinesTable.id),
    ]);

    assert.equal(originalEntry.status, "void");
    assert.ok(originalEntry.voidedAt);
    assert.equal(reversalEntry.status, "posted");
    assert.equal(reversalEntry.sourceType, "reversal");
    assert.equal(reversalEntry.sourceId, original.journalEntryId);
    assert.deepEqual(
      reversalLines.map(({ accountId, debit, credit }) => ({ accountId, debit, credit })),
      originalLines.map(({ accountId, debit, credit }) => ({ accountId, debit: credit, credit: debit })),
    );
  });

  it("can reverse a historical entry after one of its accounts becomes inactive", async () => {
    const original = await post([
      { accountId: debitAccountId, debit: 75, credit: 0 },
      { accountId: creditAccountId, debit: 0, credit: 75 },
    ]);
    entryIds.push(original.journalEntryId);
    await db.update(chartOfAccountsTable).set({ isActive: false }).where(eq(chartOfAccountsTable.id, debitAccountId));

    const result = await db.transaction((tx) => voidJournalEntry(tx, {
      journalEntryId: original.journalEntryId,
      voidedBy: null,
    }));
    entryIds.push(result.reversalEntryId);

    const [reversal] = await db.select().from(journalEntriesTable)
      .where(eq(journalEntriesTable.id, result.reversalEntryId));
    assert.equal(reversal.status, "posted");
  });
});