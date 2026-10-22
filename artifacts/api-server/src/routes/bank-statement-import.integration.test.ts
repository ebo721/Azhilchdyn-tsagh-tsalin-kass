import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import ExcelJS from "exceljs";
import { and, eq, inArray } from "drizzle-orm";
import {
  bankAccountsTable, bankTransactionsTable, cashTransactionsTable, chartOfAccountsTable,
  db, journalEntriesTable, usersTable,
} from "@workspace/db";
import app from "../app";
import { assertStatementAccountMatches } from "../lib/bank-statement-account.js";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import { postJournalEntry } from "../lib/journal-posting.js";

function iban(account: string, bankCode = "0030") {
  const bban = bankCode + account.padStart(12, "0");
  const remainder = BigInt(bban + "222300") % 97n; // MN = 22, 23
  return `MN${String(98n - remainder).padStart(2, "0")}${bban}`;
}

function cells(...values: string[]) {
  return new Map(values.map((value, index) => [index, value]));
}

describe("statement owner-account validation", () => {
  const account = "5000015555";
  it("matches domestic account metadata after titles and blanks", () => {
    assert.doesNotThrow(() => assertStatementAccountMatches([
      cells("ДАНСНЫ ХУУЛГА"), cells("Дансны нэр", "Test company"), cells(),
      cells("Дансны дугаар", account),
    ], account));
  });
  it("matches equivalent IBAN and domestic formats, including harmless separators", () => {
    const number = iban(account);
    assert.doesNotThrow(() => assertStatementAccountMatches([
      cells(`IBAN: ${number.toLowerCase().replace(/(.{4})/g, "$1 ")}`),
      cells("Дансны дугаар", "5000-015555"),
    ], account));
    assert.doesNotThrow(() => assertStatementAccountMatches([cells("Дансны дугаар", account)], number));
  });
  it("rejects a different account", () => {
    assert.throws(() => assertStatementAccountMatches([cells("Дансны дугаар", account)], "5000030006"), /таарахгүй/);
  });
  it("does not equate different banks with the same domestic digits", () => {
    assert.throws(() => assertStatementAccountMatches([cells("IBAN", iban(account, "0038"))], account), /таарахгүй/);
  });
  it("rejects invalid IBAN checksums and incomplete declarations", () => {
    assert.throws(() => assertStatementAccountMatches([cells("IBAN", `MN00${iban(account).slice(4)}`)], account), /буруу/);
    assert.throws(() => assertStatementAccountMatches([cells("Дансны дугаар", "")], account), /хоосон/);
  });
  it("rejects conflicting owner-account declarations", () => {
    assert.throws(() => assertStatementAccountMatches([
      cells("Дансны дугаар", account), cells("IBAN", iban("5000030006")),
    ], account), /зөрүүтэй/);
  });
  it("does not infer the owner from counterparty accounts or unrelated metadata", () => {
    assert.throws(() => assertStatementAccountMatches([
      cells("Дансны нэр", "Test company"), cells("Харьцсан данс / Нэр", account),
    ], account), /олдсонгүй/);
  });
});

describe("bank statement import account guard", () => {
  let server: Server | undefined;
  let baseUrl: string;
  let cookie: string;
  let userId: number | undefined;
  let accountIds: number[] = [];
  let cashId: number | undefined;
  let journalId: number | undefined;
  let validFile: Buffer;
  const account = String(1_000_000_000 + Number.parseInt(randomUUID().slice(0, 8), 16));
  const otherAccount = String(Number(account) + 1);
  const marker = `statement-account-${randomUUID()}`;
  const headers = ["Огноо", "Зарлага", "Орлого", "Exchange", "Харьцсан данс / Нэр", "Үлдэгдэл", "Гүйлгээний утга", "Гүйлгээ хийсэн огноо"];

  async function statement(preamble: string[][], footer: string[][] = []) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Хуулга");
    sheet.addRows(preamble);
    sheet.addRow(headers);
    sheet.addRow(["2099-10-20", "4000000", "0", "1", account, "5000000", marker, "2099-10-20 21:04:46"]);
    sheet.addRow(["2099-10-20", "20000", "0", "1", account, "4980000", marker, "2099-10-20 21:05:46"]);
    sheet.addRows(footer);
    return Buffer.from(await workbook.xlsx.writeBuffer({ useSharedStrings: true }));
  }

  async function upload(file: Buffer, accountId = accountIds[0]) {
    return fetch(`${baseUrl}/api/bank-transactions/import?bankAccountId=${accountId}`, {
      method: "POST", headers: { cookie, "content-type": "application/octet-stream" },
      body: new Uint8Array(file),
    });
  }

  async function importedRows() {
    return db.select().from(bankTransactionsTable).where(inArray(bankTransactionsTable.bankAccountId, accountIds));
  }

  before(async () => {
    process.env.SESSION_SECRET = "statement-owner-account-tests";
    const [user] = await db.insert(usersTable).values({
      username: marker, normalizedUsername: marker, role: "admin", passwordHash: "test-only",
    }).returning();
    userId = user.id;
    cookie = `${hrCookie.name}=${createStaffSession(user)}`;
    const accounts = await db.insert(bankAccountsTable).values([
      { bankName: `Капитрон тест ${marker}`, accountNumber: account },
      { bankName: `Капитрон тест ${marker}`, accountNumber: otherAccount },
    ]).returning();
    accountIds = accounts.map(row => row.id);
    validFile = await statement([["Дансны дугаар", account], ["IBAN", iban(account)]]);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    if (accountIds.length) {
      await db.update(bankTransactionsTable).set({ cashTransactionId: null, journalEntryId: null })
        .where(inArray(bankTransactionsTable.bankAccountId, accountIds));
      if (cashId) await db.delete(cashTransactionsTable).where(eq(cashTransactionsTable.id, cashId));
      await db.delete(bankTransactionsTable).where(inArray(bankTransactionsTable.bankAccountId, accountIds));
      await db.delete(bankAccountsTable).where(inArray(bankAccountsTable.id, accountIds));
    }
    if (journalId) await db.delete(journalEntriesTable).where(eq(journalEntriesTable.id, journalId));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  it("rejects a different selected account without storing any of the statement", async () => {
    const response = await upload(validFile, accountIds[1]);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /таарахгүй/);
    assert.equal((await importedRows()).length, 0);
  });

  it("rejects a statement with no owner metadata even when counterparties match the selected account", async () => {
    const response = await upload(await statement([]));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /олдсонгүй/);
    assert.equal((await importedRows()).length, 0);
  });

  it("does not trust owner-looking footer rows after the transaction table", async () => {
    const response = await upload(await statement([], [["Дансны дугаар", account]]));
    assert.equal(response.status, 400);
    assert.equal((await importedRows()).length, 0);
  });

  it("rejects conflicting or unreadable owner metadata atomically", async () => {
    for (const preamble of [
      [["Дансны дугаар", account], ["IBAN", iban(otherAccount)]],
      [["Дансны дугаар", "not-an-account"]],
      [["IBAN", `MN00${iban(account).slice(4)}`]],
    ]) {
      const response = await upload(await statement(preamble));
      assert.equal(response.status, 400);
      assert.equal((await importedRows()).length, 0);
    }
  });

  it("imports a matching statement and skips reimports without changing existing cash/journal links", async () => {
    const response = await upload(validFile);
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal((await response.json()).imported, 2);
    const rows = await importedRows();
    assert.equal(rows.length, 2);
    const bank = rows.find(row => Number(row.amount) === 4_000_000)!;
    const accounts = await db.select().from(chartOfAccountsTable)
      .where(and(inArray(chartOfAccountsTable.code, ["1010", "6900"]), eq(chartOfAccountsTable.isActive, true)));
    const funding = accounts.find(row => row.code === "1010");
    const expense = accounts.find(row => row.code === "6900");
    assert.ok(funding && expense);
    const entry = await db.transaction(tx => postJournalEntry(tx, {
      date: "2099-10-20", description: marker, sourceType: "bank_transaction", sourceId: bank.id, createdBy: null,
      lines: [
        { accountId: expense.id, debit: 4_000_000, credit: 0 },
        { accountId: funding.id, debit: 0, credit: 4_000_000 },
      ],
    }));
    journalId = entry.journalEntryId;
    const verifiedAt = new Date("2099-10-20T21:10:00Z");
    const [cash] = await db.insert(cashTransactionsTable).values({
      type: "expense", category: "Test expense", description: marker, amount: 4_000_000,
      date: "2099-10-20", bankTransactionId: bank.id, bankVerifiedAt: verifiedAt,
      journalEntryId: journalId, sourceType: "bank_transaction", sourceKey: `bank:${bank.id}`,
    }).returning();
    cashId = cash.id;
    await db.update(bankTransactionsTable).set({
      cashTransactionId: cash.id, journalEntryId: journalId, transferredAt: verifiedAt,
    }).where(eq(bankTransactionsTable.id, bank.id));

    const duplicate = await upload(validFile);
    assert.equal(duplicate.status, 201);
    const result = await duplicate.json();
    assert.equal(result.imported, 0);
    assert.equal(result.skippedDuplicate, 2);
    assert.equal((await importedRows()).length, 2);
    const wrongAccount = await upload(validFile, accountIds[1]);
    assert.equal(wrongAccount.status, 400);
    assert.equal((await importedRows()).length, 2);
    const [linkedBank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id));
    const [linkedCash] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cash.id));
    assert.equal(linkedBank.cashTransactionId, cash.id);
    assert.equal(linkedBank.journalEntryId, journalId);
    assert.equal(linkedBank.transferredAt?.toISOString(), verifiedAt.toISOString());
    assert.equal(linkedCash.bankTransactionId, bank.id);
    assert.equal(linkedCash.journalEntryId, journalId);
    assert.equal(linkedCash.bankVerifiedAt?.toISOString(), verifiedAt.toISOString());
  });

  it("still allows genuine statements for different owner accounts without global deduplication", async () => {
    const response = await upload(await statement([["Дансны дугаар", otherAccount]]), accountIds[1]);
    assert.equal(response.status, 201);
    assert.equal((await response.json()).imported, 2);
    assert.equal((await importedRows()).length, 4);
  });
});
