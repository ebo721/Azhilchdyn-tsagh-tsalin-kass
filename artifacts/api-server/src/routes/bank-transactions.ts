import { Router, raw, type IRouter } from "express";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import {
  DeleteBankTransactionParams,
  DeleteBankTransactionJournalParams,
  DeleteBankTransactionJournalResponse,
  CreateBankAccountBody,
  CreateBankAccountResponse,
  ImportKapitronBankTransactionsResponse,
  ImportKapitronBankTransactionsQueryParams,
  ListBankTransactionJournalReviewResponse,
  LinkBankTransactionToCashBody,
  LinkBankTransactionToCashParams,
  LinkBankTransactionToCashResponse,
  ListBankTransactionCashSuggestionsParams,
  ListBankTransactionCashSuggestionsResponse,
  ListBankTransactionsResponse,
  ListBankAccountsResponse,
  ListUnclearTransactionsResponse,
  MarkTransactionUnclearParams,
  PostBankTransactionJournalBody,
  PostBankTransactionJournalParams,
  PostBankTransactionJournalResponse,
  RejectBankTransactionSuggestionParams,
  LinkBankTransactionPurchaseBody,
  LinkBankTransactionPurchaseParams,
  LinkBankTransactionPurchaseResponse,
  LinkBankTransactionExpenseBody,
  LinkBankTransactionExpenseParams,
  LinkBankTransactionExpenseResponse,
  LinkBankTransactionFixedAssetBody,
  LinkBankTransactionFixedAssetParams,
  LinkBankTransactionFixedAssetResponse,
  TransferBankTransactionToCashBody,
  TransferBankTransactionToCashParams,
  TransferBankTransactionToCashResponse,
  UpdateBankTransactionAccountBody,
  UpdateBankTransactionAccountParams,
  UpdateBankTransactionAccountResponse,
} from "@workspace/api-zod";
import { and, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { bankAccountsTable, bankTransactionsTable, cashClosuresTable, cashTransactionsTable, chartOfAccountsTable, db, deletionRequestsTable, journalEntriesTable } from "@workspace/db";
import { getStaffSession } from "../lib/hr-session.js";
import { syncOperatingExpenseForBankCash } from "../lib/operating-expense-sync.js";
import { cashAccountForCategory } from "../lib/cash-account.js";
import { postJournalEntry, voidJournalEntry } from "../lib/journal-posting.js";
import { loadBankRecognitionContext, recognizeBankTransaction } from "../lib/bank-recognition.js";
import { linkBankPurchase, linkBankExpense, linkBankFixedAsset } from "../lib/bank-document-linking.js";

const router: IRouter = Router();
const maxUploadBytes = 10 * 1024 * 1024;
const maxXmlBytes = 8 * 1024 * 1024;
const maxRows = 20_000;
const requiredHeaders = ["Огноо", "Зарлага", "Орлого", "Exchange", "Харьцсан данс / Нэр", "Үлдэгдэл", "Гүйлгээний утга", "Гүйлгээ хийсэн огноо"];

class BankCashLinkConflictError extends Error {}

async function accountByCode(tx: any, code: string, type: string) {
  const [account] = await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.code, code),
    eq(chartOfAccountsTable.type, type),
    eq(chartOfAccountsTable.isActive, true),
  ));
  if (!account) throw new Error(`Journal account ${code} is missing or inactive`);
  return account;
}

async function counterAccount(tx: any, type: string, category: string, mapped: any) {
  if (type === "income" && mapped?.isActive && mapped.type === "revenue") return mapped;
  if (type === "expense" && mapped?.isActive && ["expense", "asset"].includes(mapped.type)) return mapped;
  return type === "income"
    ? accountByCode(tx, "4900", "revenue")
    : accountByCode(tx, "6900", "expense");
}

async function postBankCashJournal(tx: any, bankTransaction: any, cash: any, counter: any) {
  const bankAccount = await accountByCode(tx, "1010", "asset");
  const result = await postJournalEntry(tx, {
    date: bankTransaction.transactionAt.toISOString().slice(0, 10),
    description: bankTransaction.description.trim() || bankTransaction.counterparty.trim() || cash.description.trim(),
    sourceType: "bank_transaction",
    sourceId: bankTransaction.id,
    createdBy: null,
    lines: cash.type === "income"
      ? [{ accountId: bankAccount.id, debit: Number(cash.amount), credit: 0 }, { accountId: counter.id, debit: 0, credit: Number(cash.amount) }]
      : [{ accountId: counter.id, debit: Number(cash.amount), credit: 0 }, { accountId: bankAccount.id, debit: 0, credit: Number(cash.amount) }],
  });
  if (result.status !== "posted") throw new Error("Bank cash journal entry must be balanced");
  return result.journalEntryId;
}

router.use(async (req, res, next) => {
  const isBankRoute = ["/bank-accounts", "/bank-transactions", "/unclear-transactions"]
    .some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`));
  if (!isBankRoute) return next();
  const session = await getStaffSession(req);
  if (!session) return res.status(401).json({ error: "Нэвтрэх шаардлагатай" });
  if (session.role === "admin" || session.role === "accountant" || (session.role === "viewer" && req.method === "GET")) return next();
  return res.status(403).json({ error: "Энэ хэсэгт хандах эрхгүй" });
});

function decodeXml(value: string) {
  return value.replace(/&(?:amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (entity, decimal, hex) => {
    if (entity === "&amp;") return "&";
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&quot;") return "\"";
    if (entity === "&apos;") return "'";
    const code = Number.parseInt(decimal || hex, hex ? 16 : 10);
    return Number.isSafeInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

function cellsFromRow(rowXml: string, sharedStrings: string[]) {
  const cells = new Map<number, string>();
  for (const match of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const reference = /\br="([A-Z]+)\d+"/.exec(match[1])?.[1];
    if (!reference) continue;
    const column = [...reference].reduce((result, letter) => result * 26 + letter.charCodeAt(0) - 64, 0) - 1;
    const type = /\bt="([^"]+)"/.exec(match[1])?.[1];
    const text = [...match[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>|<v[^>]*>([\s\S]*?)<\/v>/g)].map((part) => decodeXml(part[1] ?? part[2] ?? "")).join("");
    cells.set(column, type === "s" ? (sharedStrings[Number(text)] ?? "") : text);
  }
  return cells;
}

export function findKapitronHeaderRow(rows: Map<number, string>[]) {
  return rows.findIndex((cells) => requiredHeaders.every((name) =>
    [...cells.values()].some((value) => value.trim() === name)));
}

function readZipEntries(buffer: Buffer) {
  const endRecordStart = Math.max(0, buffer.length - 65_557);
  let endRecordOffset = -1;
  for (let offset = buffer.length - 22; offset >= endRecordStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endRecordOffset = offset;
      break;
    }
  }
  if (endRecordOffset < 0 || endRecordOffset + 22 > buffer.length) throw new Error("Kapitron XLSX бүтэц буруу байна");

  const entryCount = buffer.readUInt16LE(endRecordOffset + 10);
  const directorySize = buffer.readUInt32LE(endRecordOffset + 12);
  const directoryOffset = buffer.readUInt32LE(endRecordOffset + 16);
  if (entryCount > 1_000 || directorySize > 1024 * 1024 || directoryOffset + directorySize > buffer.length) {
    throw new Error("Kapitron XLSX бүтэц буруу байна");
  }

  const entries = new Map<string, { compression: number; compressedSize: number; size: number; offset: number }>();
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Kapitron XLSX бүтэц буруу байна");
    const flags = buffer.readUInt16LE(offset + 8);
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if ((flags & 1) !== 0 || nextOffset > buffer.length) throw new Error("Kapitron XLSX бүтэц буруу байна");
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.set(name, { compression, compressedSize, size, offset: buffer.readUInt32LE(offset + 42) });
    offset = nextOffset;
  }

  const read = (name: string) => {
    const entry = entries.get(name);
    if (!entry || entry.size > maxXmlBytes || entry.offset + 30 > buffer.length || buffer.readUInt32LE(entry.offset) !== 0x04034b50) {
      throw new Error("Kapitron XLSX бүтэц буруу байна");
    }
    const nameLength = buffer.readUInt16LE(entry.offset + 26);
    const extraLength = buffer.readUInt16LE(entry.offset + 28);
    const dataOffset = entry.offset + 30 + nameLength + extraLength;
    if (dataOffset + entry.compressedSize > buffer.length) throw new Error("Kapitron XLSX бүтэц буруу байна");
    const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);
    const value = entry.compression === 0
      ? compressed
      : entry.compression === 8
        ? inflateRawSync(compressed, { maxOutputLength: maxXmlBytes })
        : null;
    if (!value || value.length !== entry.size) throw new Error("Kapitron XLSX бүтэц буруу байна");
    return value.toString("utf8");
  };
  return { names: [...entries.keys()], read };
}

function parseDate(value: string): Date | null {
  const text = value.trim();
  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 1 && serial < 100000) {
    return new Date(Math.floor((serial - 25569) * 86400) * 1000);
  }
  const normalized = /^\d{4}-\d\d-\d\d(?:[ T]\d\d:\d\d(?::\d\d)?)?$/.test(text)
    ? text.replace(" ", "T")
    : (() => {
      const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d\d):(\d\d)(?::(\d\d))?)?$/.exec(text);
      return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}T${match[4] ?? "00"}:${match[5] ?? "00"}:${match[6] ?? "00"}` : "";
    })();
  const date = new Date(normalized);
  return normalized && !Number.isNaN(date.valueOf()) ? new Date(Math.floor(date.valueOf() / 1000) * 1000) : null;
}

function parseAmount(value: string) {
  const amount = Number(value.replace(/[\s,]/g, ""));
  return Number.isFinite(amount) ? Math.abs(amount) : 0;
}

function calendarDateOffset(date: string, offset: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function descriptionTokens(value: string) {
  return new Set(value.toLocaleLowerCase("mn-MN").match(/[\p{L}\p{N}]+/gu) ?? []);
}

function suggestionScore(bank: typeof bankTransactionsTable.$inferSelect, cash: typeof cashTransactionsTable.$inferSelect) {
  const bankDate = bank.transactionAt.toISOString().slice(0, 10);
  const distance = Math.abs((Date.parse(`${cash.date}T00:00:00Z`) - Date.parse(`${bankDate}T00:00:00Z`)) / 86_400_000);
  const bankAmount = Number(bank.amount);
  const cashAmount = Number(cash.amount);
  const amountCloseness = Math.max(0, 1 - Math.abs(bankAmount - cashAmount) / Math.max(bankAmount, cashAmount, 1));
  const bankTokens = descriptionTokens(bank.description);
  const cashTokens = descriptionTokens(cash.description);
  const overlap = [...bankTokens].filter((token) => cashTokens.has(token)).length;
  const tokenOverlap = overlap / Math.max(new Set([...bankTokens, ...cashTokens]).size, 1);
  return Math.round((0.4 * (1 - distance / 7) + 0.35 * amountCloseness + 0.25 * tokenOverlap) * 10_000) / 100;
}

function cashSuggestionResponse(row: typeof cashTransactionsTable.$inferSelect, score: number) {
  const isOperatingExpense = row.type === "expense"
    && !["payroll", "payroll_advance", "inventory_purchase", "fixed_asset_purchase"].includes(row.sourceType ?? "");
  const category = row.type === "expense"
    ? row.sourceType === "payroll" || row.sourceType === "payroll_advance"
      ? "Цалин"
      : row.sourceType === "inventory_purchase"
        ? "Бараа материал"
        : row.sourceType === "fixed_asset_purchase"
          ? "Эд хөрөнгө"
          : "Үйл ажиллагааны зардал"
    : row.category;
  return {
    id: row.id,
    type: row.type as "income" | "expense",
    category,
    subcategory: isOperatingExpense && row.category !== "Үйл ажиллагааны зардал" ? row.category : null,
    description: row.description,
    amount: Number(row.amount),
    date: String(row.date),
    bankTransactionId: row.bankTransactionId,
    bankVerifiedAt: row.bankVerifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    editable: row.sourceType === null,
    transactionKind: (row.sourceType ?? "manual") as "manual" | "payroll" | "payroll_advance" | "inventory_purchase" | "fixed_asset_purchase" | "bank_transaction",
    score,
  };
}

export async function readKapitronXlsx(buffer: Buffer) {
  const zip = readZipEntries(buffer);
  const sheet = zip.names.find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheet) throw new Error("Kapitron XLSX бүтэц буруу байна");
  const strings = zip.read("xl/sharedStrings.xml");
  const worksheet = zip.read(sheet);
  const shared = [...strings.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join(""));
  const rows = [...worksheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)];
  if (rows.length > maxRows + 1) throw new Error("XLSX мөрийн тоо хэт их байна");
  const parsedRows = rows.map((row) => cellsFromRow(row[1], shared));
  const headerRowIndex = findKapitronHeaderRow(parsedRows);
  if (headerRowIndex < 0) throw new Error("Kapitron баганын толгой буруу байна");
  const header = parsedRows[headerRowIndex];
  const indexes = new Map(requiredHeaders.map((name) => [name, [...header].find(([, value]) => value.trim() === name)?.[0]]));
  if ([...indexes.values()].some((index) => index === undefined)) throw new Error("Kapitron баганын толгой буруу байна");
  return parsedRows.slice(headerRowIndex + 1).map((cells) => Object.fromEntries(
    requiredHeaders.map((name) => [name, cells.get(indexes.get(name)!)?.trim() ?? ""]),
  ));
}

const response = (
  row: typeof bankTransactionsTable.$inferSelect,
  accountCode: string | null = null,
  accountName: string | null = null,
) => ({
  id: row.id, transactionAt: row.transactionAt.toISOString(), type: row.type as "income" | "expense",
  amount: Number(row.amount), accountId: row.accountId, accountCode, accountName,
  account: row.account, counterparty: row.counterparty, description: row.description,
  executedAt: row.executedAt?.toISOString() ?? null, balance: row.balance === null ? null : Number(row.balance),
  transferredAt: row.transferredAt?.toISOString() ?? null, cashTransactionId: row.cashTransactionId,
  bankAccountId: row.bankAccountId, bankName: row.bankName, bankAccountNumber: row.bankAccountNumber,
  createdAt: row.createdAt.toISOString(),
});

async function responseWithAccount(row: typeof bankTransactionsTable.$inferSelect) {
  if (row.accountId === null) return response(row);
  const [account] = await db.select({
    code: chartOfAccountsTable.code,
    name: chartOfAccountsTable.name,
  }).from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, row.accountId));
  return response(row, account?.code ?? null, account?.name ?? null);
}

export const isExcludedBankFee = (amount: number, description: string) => {
  const normalizedDescription = description.toLocaleUpperCase("mn-MN");
  return (amount === 200 && normalizedDescription.includes("ШИМТГЭЛ"))
    || (amount === 50
      && (normalizedDescription.includes("МЕССЭЖ") || normalizedDescription.includes("МЭССЭЖ"))
      && normalizedDescription.includes("МЭДЭГД")
      && normalizedDescription.includes("ШИМТГЭЛ"));
};

router.get("/bank-accounts", async (_req, res, next) => {
  try {
    const rows = await db.select().from(bankAccountsTable).orderBy(bankAccountsTable.bankName, bankAccountsTable.accountNumber);
    res.json(ListBankAccountsResponse.parse(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))));
  } catch (error) { next(error); }
});

router.post("/bank-accounts", async (req, res, next) => {
  try {
    const input = CreateBankAccountBody.parse(req.body);
    const [created] = await db.insert(bankAccountsTable).values({
      bankName: input.bankName.trim(),
      accountNumber: input.accountNumber.trim(),
    }).onConflictDoNothing().returning();
    if (!created) {
      res.status(409).json({ error: "Энэ банкны данс аль хэдийн бүртгэгдсэн байна" });
      return;
    }
    res.status(201).json(CreateBankAccountResponse.parse({ ...created, createdAt: created.createdAt.toISOString() }));
  } catch (error) { next(error); }
});

router.get("/bank-transactions", async (_req, res, next) => {
  try {
    const rows = await db.select({
      transaction: bankTransactionsTable,
      accountCode: chartOfAccountsTable.code,
      accountName: chartOfAccountsTable.name,
    }).from(bankTransactionsTable)
      .leftJoin(chartOfAccountsTable, eq(bankTransactionsTable.accountId, chartOfAccountsTable.id))
      .where(and(
        isNull(bankTransactionsTable.cashTransactionId),
        isNull(bankTransactionsTable.transferredAt),
        isNull(bankTransactionsTable.unclearAt),
        isNull(bankTransactionsTable.journalEntryId),
      ))
      .orderBy(desc(bankTransactionsTable.transactionAt), desc(bankTransactionsTable.id));
    res.json(ListBankTransactionsResponse.parse(rows.map((row) =>
      response(row.transaction, row.accountCode, row.accountName))));
  } catch (error) { next(error); }
});

router.get("/bank-transactions/journal-review", async (_req, res, next) => {
  try {
    const [rows, recognitionContext] = await Promise.all([
      db.select({
        transaction: bankTransactionsTable,
        suggestedAccountName: chartOfAccountsTable.name,
      }).from(bankTransactionsTable)
      .leftJoin(chartOfAccountsTable, eq(bankTransactionsTable.accountId, chartOfAccountsTable.id))
      .where(and(
        isNull(bankTransactionsTable.cashTransactionId),
        isNull(bankTransactionsTable.transferredAt),
        isNull(bankTransactionsTable.unclearAt),
        isNull(bankTransactionsTable.journalEntryId),
      ))
      .orderBy(desc(bankTransactionsTable.transactionAt), desc(bankTransactionsTable.id)),
      loadBankRecognitionContext(),
    ]);
    res.json(ListBankTransactionJournalReviewResponse.parse(rows.map(({ transaction, suggestedAccountName }) => {
      const recognition = recognizeBankTransaction(transaction, recognitionContext);
      const existingPurchaseMatch = transaction.accountId !== null
        && recognition.accountId === transaction.accountId
        ? recognition.existingPurchaseMatch
        : null;
      return {
        id: transaction.id,
        date: transaction.transactionAt.toISOString().slice(0, 10),
        transactionAt: transaction.transactionAt.toISOString(),
        type: transaction.type,
        description: transaction.description,
        amount: Number(transaction.amount),
        counterparty: transaction.counterparty,
        suggestedAccountId: transaction.accountId,
        suggestedAccountName,
        ...(existingPurchaseMatch ? { existingPurchaseMatch } : {}),
      };
    })));
  } catch (error) { next(error); }
});

router.post("/bank-transactions/:id/link-purchase", async (req, res, next) => {
  try {
    const { id } = LinkBankTransactionPurchaseParams.parse(req.params);
    const result = await linkBankPurchase(id, LinkBankTransactionPurchaseBody.parse(req.body));
    if (typeof result === "string") {
      const status = result === "missing_bank" || result === "missing_purchase" ? 404 : result === "bank_resolved" || result === "purchase_conflict" || result === "closed" ? 409 : 400;
      return res.status(status).json({ error: result });
    }
    return res.json(LinkBankTransactionPurchaseResponse.parse(result));
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505" || (error instanceof Error && error.message.includes("claimed concurrently"))) return res.status(409).json({ error: "Банкны гүйлгээ аль хэдийн холбогдсон байна" });
    return next(error);
  }
});

router.post("/bank-transactions/:id/link-expense", async (req, res, next) => {
  try {
    const { id } = LinkBankTransactionExpenseParams.parse(req.params);
    const result = await linkBankExpense(id, LinkBankTransactionExpenseBody.parse(req.body));
    if (typeof result === "string") {
      const status = result === "missing_bank" || result === "missing_expense" ? 404 : result === "bank_resolved" || result === "expense_conflict" || result === "closed" ? 409 : 400;
      return res.status(status).json({ error: result });
    }
    return res.json(LinkBankTransactionExpenseResponse.parse(result));
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505" || (error instanceof Error && error.message.includes("claimed concurrently"))) return res.status(409).json({ error: "Банкны гүйлгээ аль хэдийн холбогдсон байна" });
    return next(error);
  }
});

router.post("/bank-transactions/:id/link-fixed-asset", async (req, res, next) => {
  try {
    const { id } = LinkBankTransactionFixedAssetParams.parse(req.params);
    const result = await linkBankFixedAsset(id, LinkBankTransactionFixedAssetBody.parse(req.body));
    if (typeof result === "string") {
      const status = result === "missing_bank" || result === "missing_fixed_asset"
        ? 404
        : result === "bank_resolved" || result === "fixed_asset_conflict" || result === "closed"
          ? 409
          : 400;
      return res.status(status).json({ error: result });
    }
    return res.json(LinkBankTransactionFixedAssetResponse.parse(result));
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code
      ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505" || (error instanceof Error && error.message.includes("claimed concurrently"))) {
      return res.status(409).json({ error: "Банкны гүйлгээ аль хэдийн холбогдсон байна" });
    }
    return next(error);
  }
});

router.post("/bank-transactions/:id/post-journal", async (req, res, next) => {
  try {
    const { id } = PostBankTransactionJournalParams.parse(req.params);
    const { accountId } = PostBankTransactionJournalBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [bank] = await tx.select().from(bankTransactionsTable)
        .where(eq(bankTransactionsTable.id, id))
        .for("update");
      if (!bank) return "missing" as const;
      if (bank.journalEntryId !== null) return { id: bank.id, journalEntryId: bank.journalEntryId };
      if (bank.cashTransactionId !== null || bank.transferredAt !== null || bank.unclearAt !== null) {
        return "resolved" as const;
      }
      const [account] = await tx.select().from(chartOfAccountsTable).where(and(
        eq(chartOfAccountsTable.id, accountId),
        eq(chartOfAccountsTable.isActive, true),
      ));
      const allowed = bank.type === "income"
        ? account?.type === "revenue"
        : account !== undefined && ["expense", "asset", "liability"].includes(account.type);
      if (!allowed) return "invalid_account" as const;
      const bankAccount = await accountByCode(tx, "1010", "asset");
      const amount = Number(bank.amount);
      const posting = await postJournalEntry(tx, {
        date: bank.transactionAt.toISOString().slice(0, 10),
        description: bank.description.trim() || bank.counterparty.trim() || "Банкны гүйлгээ",
        sourceType: "bank",
        sourceId: bank.id,
        createdBy: null,
        lines: bank.type === "income"
          ? [{ accountId: bankAccount.id, debit: amount, credit: 0 }, { accountId: account.id, debit: 0, credit: amount }]
          : [{ accountId: account.id, debit: amount, credit: 0 }, { accountId: bankAccount.id, debit: 0, credit: amount }],
      });
      if (posting.status !== "posted") throw new Error("Bank journal entry must be balanced");
      await tx.update(bankTransactionsTable).set({
        accountId: account.id,
        journalEntryId: posting.journalEntryId,
      }).where(eq(bankTransactionsTable.id, bank.id));
      return { id: bank.id, journalEntryId: posting.journalEntryId };
    });
    if (result === "missing") {
      res.status(404).json({ error: "Банкны гүйлгээ олдсонгүй" });
      return;
    }
    if (result === "resolved") {
      res.status(409).json({ error: "Банкны гүйлгээ аль хэдийн шийдвэрлэгдсэн байна" });
      return;
    }
    if (result === "invalid_account") {
      res.status(400).json({ error: "Гүйлгээний төрөлд тохирох идэвхтэй GL данс сонгоно уу" });
      return;
    }
    res.json(PostBankTransactionJournalResponse.parse(result));
  } catch (error) { next(error); }
});

router.delete("/bank-transactions/:id/journal", async (req, res, next) => {
  try {
    const { id } = DeleteBankTransactionJournalParams.parse(req.params);
    const session = await getStaffSession(req);
    const result = await db.transaction(async (tx) => {
      const [bank] = await tx.select().from(bankTransactionsTable)
        .where(eq(bankTransactionsTable.id, id))
        .for("update");
      if (!bank) return "missing" as const;
      if (bank.cashTransactionId !== null || bank.transferredAt !== null) return "source_managed" as const;
      if (bank.journalEntryId === null) return "not_posted" as const;

      const [entry] = await tx.select().from(journalEntriesTable)
        .where(eq(journalEntriesTable.id, bank.journalEntryId))
        .for("update");
      if (!entry
        || entry.sourceType !== "bank"
        || entry.sourceId !== bank.id
        || entry.status !== "posted") {
        return "source_managed" as const;
      }

      const { reversalEntryId } = await voidJournalEntry(tx, {
        journalEntryId: entry.id,
        voidedBy: session?.id ?? null,
      });
      const rejectedAccountIds = bank.accountId === null
        ? bank.rejectedAccountIds
        : [...new Set([...bank.rejectedAccountIds, bank.accountId])];
      await tx.update(bankTransactionsTable).set({
        accountId: null,
        journalEntryId: null,
        rejectedAccountIds,
      }).where(eq(bankTransactionsTable.id, bank.id));
      return {
        bankTransactionId: bank.id,
        voidedJournalEntryId: entry.id,
        reversalJournalEntryId: reversalEntryId,
      };
    });
    if (result === "missing") {
      res.status(404).json({ error: "Банкны гүйлгээ олдсонгүй" });
      return;
    }
    if (result === "not_posted") {
      res.status(409).json({ error: "Устгах батлагдсан банкны журнал алга" });
      return;
    }
    if (result === "source_managed") {
      res.status(409).json({ error: "Касс эсвэл баримттай холбоотой журналыг эх үүсвэр цэснээс цуцална уу" });
      return;
    }
    res.json(DeleteBankTransactionJournalResponse.parse(result));
  } catch (error) { next(error); }
});

router.post("/bank-transactions/:id/reject-suggestion", async (req, res, next) => {
  try {
    const { id } = RejectBankTransactionSuggestionParams.parse(req.params);
    const result = await db.transaction(async (tx) => {
      const [bank] = await tx.select().from(bankTransactionsTable)
        .where(eq(bankTransactionsTable.id, id))
        .for("update");
      if (!bank) return "missing" as const;
      if (bank.cashTransactionId !== null || bank.transferredAt !== null || bank.unclearAt !== null || bank.journalEntryId !== null) {
        return "resolved" as const;
      }
      const rejectedAccountIds = bank.accountId === null
        ? bank.rejectedAccountIds
        : [...new Set([...bank.rejectedAccountIds, bank.accountId])];
      await tx.update(bankTransactionsTable).set({
        accountId: null,
        rejectedAccountIds,
      }).where(eq(bankTransactionsTable.id, id));
      return "rejected" as const;
    });
    if (result === "missing") {
      res.status(404).json({ error: "Банкны гүйлгээ олдсонгүй" });
      return;
    }
    if (result === "resolved") {
      res.status(409).json({ error: "Банкны гүйлгээ аль хэдийн шийдвэрлэгдсэн байна" });
      return;
    }
    res.status(204).end();
  } catch (error) { next(error); }
});

router.patch("/bank-transactions/:id/account", async (req, res, next) => {
  try {
    const { id } = UpdateBankTransactionAccountParams.parse(req.params);
    const { accountId } = UpdateBankTransactionAccountBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [bank] = await tx.select().from(bankTransactionsTable)
        .where(eq(bankTransactionsTable.id, id))
        .for("update");
      if (!bank) return "missing" as const;
      if (bank.cashTransactionId !== null || bank.transferredAt !== null || bank.unclearAt !== null || bank.journalEntryId !== null) {
        return "resolved" as const;
      }
      const account = accountId === null
        ? null
        : (await tx.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, accountId)))[0] ?? null;
      if (accountId !== null && !account) return "invalid_account" as const;
      const [updated] = await tx.update(bankTransactionsTable)
        .set({
          accountId,
          rejectedAccountIds: accountId === null
            ? bank.rejectedAccountIds
            : bank.rejectedAccountIds.filter((rejectedId) => rejectedId !== accountId),
        })
        .where(eq(bankTransactionsTable.id, id))
        .returning();
      return { updated, account };
    });
    if (result === "missing") {
      res.status(404).json({ error: "Банкны гүйлгээ олдсонгүй" });
      return;
    }
    if (result === "resolved") {
      res.status(409).json({ error: "Банкны гүйлгээ аль хэдийн шийдвэрлэгдсэн байна" });
      return;
    }
    if (result === "invalid_account") {
      res.status(400).json({ error: "Хүчинтэй данс сонгоно уу" });
      return;
    }
    res.json(UpdateBankTransactionAccountResponse.parse(
      response(result.updated, result.account?.code ?? null, result.account?.name ?? null),
    ));
  } catch (error) { next(error); }
});

router.post("/bank-transactions/import", raw({ type: "application/octet-stream", limit: maxUploadBytes }), async (req, res, next) => {
  try {
    const { bankAccountId } = ImportKapitronBankTransactionsQueryParams.parse(req.query);
    const [selectedAccount] = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.id, bankAccountId));
    if (!selectedAccount) {
      res.status(404).json({ error: "Сонгосон банкны данс олдсонгүй" });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Kapitron XLSX файл шаардлагатай" });
      return;
    }
    const rows = await readKapitronXlsx(req.body);
    let skippedZero = 0;
    const values = rows.flatMap((row) => {
      const expense = parseAmount(row["Зарлага"]);
      const income = parseAmount(row["Орлого"]);
      if (!expense && !income) {
        skippedZero += 1;
        return [];
      }
      if (row["Огноо"] === "Нийт төлбөр" && !row["Гүйлгээ хийсэн огноо"]) return [];
      const transactionAt = parseDate(row["Гүйлгээ хийсэн огноо"]);
      if (!transactionAt) throw new Error("Гүйлгээ хийсэн огноо буруу байна");
      const type = income ? "income" : "expense";
      const amount = income || expense;
      const account = row["Харьцсан данс / Нэр"];
      const description = row["Гүйлгээний утга"];
      if (isExcludedBankFee(amount, description)) return [];
      const legacyFingerprint = createHash("sha256").update(JSON.stringify([
        transactionAt.toISOString(),
        amount,
        account,
        description,
      ])).digest("hex");
      const fingerprint = createHash("sha256").update(JSON.stringify([
        bankAccountId,
        transactionAt.toISOString(),
        amount,
        account,
        description,
      ])).digest("hex");
      return [{ transactionAt, type, amount, account, counterparty: account, balance: row["Үлдэгдэл"] ? parseAmount(row["Үлдэгдэл"]) : null, description, executedAt: transactionAt, fingerprint, legacyFingerprint, bankAccountId, bankName: selectedAccount.bankName, bankAccountNumber: selectedAccount.accountNumber }];
    });
    const legacyRows = await db.select({ id: bankTransactionsTable.id, fingerprint: bankTransactionsTable.fingerprint })
      .from(bankTransactionsTable)
      .where(isNull(bankTransactionsTable.bankAccountId));
    const legacyByFingerprint = new Map(legacyRows.map((row) => [row.fingerprint, row.id]));
    const recognitionContext = await loadBankRecognitionContext();
    const inserted = await db.transaction(async (tx) => {
      const pending = [];
      for (const { legacyFingerprint, ...value } of values) {
        const legacyId = legacyByFingerprint.get(legacyFingerprint);
        if (legacyId) {
          await tx.update(bankTransactionsTable).set({
            bankAccountId,
            bankName: selectedAccount.bankName,
            bankAccountNumber: selectedAccount.accountNumber,
            fingerprint: value.fingerprint,
          }).where(eq(bankTransactionsTable.id, legacyId));
          legacyByFingerprint.delete(legacyFingerprint);
        } else {
          pending.push({
            ...value,
            accountId: recognizeBankTransaction(value, recognitionContext).accountId,
          });
        }
      }
      return pending.length
        ? await tx.insert(bankTransactionsTable).values(pending).onConflictDoNothing().returning({
          id: bankTransactionsTable.id,
          accountId: bankTransactionsTable.accountId,
        })
        : [];
    });
    res.status(201).json(ImportKapitronBankTransactionsResponse.parse({
      imported: inserted.length,
      skippedDuplicate: values.length - inserted.length,
      skippedZero,
      totalRead: inserted.length,
      recognized: inserted.filter((row) => row.accountId !== null).length,
      unrecognized: inserted.filter((row) => row.accountId === null).length,
      transactionIds: inserted.map((row) => row.id),
    }));
  } catch (error) { next(error); }
});

router.post("/bank-transactions/:id/transfer-to-cash", async (req, res, next) => {
  try {
    const { id } = TransferBankTransactionToCashParams.parse(req.params);
    const { category, incomeMonth } = TransferBankTransactionToCashBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [bank] = await tx.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id)).for("update");
      if (!bank) return null;
      if (bank.cashTransactionId !== null || bank.transferredAt !== null) {
        if (bank.cashTransactionId !== null && bank.journalEntryId !== null) {
          const [linkedCash] = await tx.select({
            journalEntryId: cashTransactionsTable.journalEntryId,
          }).from(cashTransactionsTable).where(eq(cashTransactionsTable.id, bank.cashTransactionId));
          if (linkedCash?.journalEntryId === bank.journalEntryId) return bank;
        }
        return "resolved" as const;
      }
      if (bank.journalEntryId !== null || bank.unclearAt !== null) return "resolved" as const;
      if (bank.type === "income" && incomeMonth === null) return "income_month_required" as const;
      const date = bank.transactionAt.toISOString().slice(0, 10);
      const [closed] = await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(eq(cashClosuresTable.date, date));
      if (closed) return "closed" as const;
      const verifiedAt = new Date();
      const account = await cashAccountForCategory(tx, category);
      const [cash] = await tx.insert(cashTransactionsTable).values({
        type: bank.type,
        category,
        accountId: account?.id ?? null,
        description: bank.description,
        amount: bank.amount,
        date,
        incomeMonth: bank.type === "income" ? incomeMonth : null,
        sourceType: "bank_transaction",
        sourceKey: `bank:${id}`,
        bankTransactionId: id,
        bankVerifiedAt: verifiedAt,
      }).onConflictDoNothing().returning();
      if (!cash) throw new BankCashLinkConflictError();
      const [updated] = await tx.update(bankTransactionsTable)
        .set({ transferredAt: verifiedAt, cashTransactionId: cash.id })
        .where(and(eq(bankTransactionsTable.id, id), isNull(bankTransactionsTable.cashTransactionId), isNull(bankTransactionsTable.transferredAt)))
        .returning();
      if (!updated) throw new BankCashLinkConflictError();
      const linkedCounter = await counterAccount(tx, cash.type, category, account);
      const journalEntryId = await postBankCashJournal(tx, bank, cash, linkedCounter);
      await tx.update(cashTransactionsTable).set({ journalEntryId }).where(eq(cashTransactionsTable.id, cash.id));
      const [postedBank] = await tx.update(bankTransactionsTable)
        .set({ journalEntryId })
        .where(eq(bankTransactionsTable.id, id))
        .returning();
      await syncOperatingExpenseForBankCash(tx, id, cash.id);
      return postedBank;
    });
    if (result === null) {
      res.status(404).json({ error: "Банкны гүйлгээ олдсонгүй" });
      return;
    }
    if (result === "closed") {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн касс руу шилжүүлэх боломжгүй" });
      return;
    }
    if (result === "income_month_required") {
      res.status(400).json({ error: "Орлогын хамаарах сар шаардлагатай" });
      return;
    }
    if (result === "resolved") {
      res.status(409).json({ error: "Банкны гүйлгээ аль хэдийн шийдвэрлэгдсэн эсвэл холбоос нь бүрэн бус байна" });
      return;
    }
    res.json(TransferBankTransactionToCashResponse.parse(await responseWithAccount(result)));
  } catch (error) {
    const databaseCode = (error as { code?: string; cause?: { code?: string } }).code
      ?? (error as { cause?: { code?: string } }).cause?.code;
    if (error instanceof BankCashLinkConflictError || databaseCode === "23505") {
      const { id } = TransferBankTransactionToCashParams.parse(req.params);
      const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
      if (bank && (bank.cashTransactionId !== null || bank.transferredAt !== null)) {
        res.json(TransferBankTransactionToCashResponse.parse(await responseWithAccount(bank)));
        return;
      }
      res.status(409).json({ error: "Банк эсвэл кассын гүйлгээ аль хэдийн холбогдсон байна" });
      return;
    }
    next(error);
  }
});

router.get("/bank-transactions/:id/cash-suggestions", async (req, res, next) => {
  try {
    const { id } = ListBankTransactionCashSuggestionsParams.parse(req.params);
    const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
    if (!bank) {
      res.status(404).json({ error: "Банкны гүйлгээ олдсонгүй" });
      return;
    }
    const bankDate = bank.transactionAt.toISOString().slice(0, 10);
    const candidates = await db.select().from(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.type, bank.type),
      isNull(cashTransactionsTable.bankTransactionId),
      isNull(cashTransactionsTable.sourceType),
      isNull(cashTransactionsTable.unclearAt),
      gte(cashTransactionsTable.date, calendarDateOffset(bankDate, -7)),
      lte(cashTransactionsTable.date, calendarDateOffset(bankDate, 7)),
    ));
    const suggestions = candidates
      .filter((cash) => Number(cash.amount) === Number(bank.amount))
      .map((cash) => ({ cash, score: suggestionScore(bank, cash) }))
      .sort((left, right) => right.score - left.score || left.cash.id - right.cash.id)
      .slice(0, 10)
      .map(({ cash, score }) => cashSuggestionResponse(cash, score));
    res.json(ListBankTransactionCashSuggestionsResponse.parse(suggestions));
  } catch (error) { next(error); }
});

router.post("/bank-transactions/:id/link-cash", async (req, res, next) => {
  try {
    const { id } = LinkBankTransactionToCashParams.parse(req.params);
    const { cashTransactionId } = LinkBankTransactionToCashBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [bank] = await tx.select().from(bankTransactionsTable)
        .where(eq(bankTransactionsTable.id, id))
        .for("update");
      if (!bank) return "missing-bank" as const;
      const [cash] = await tx.select().from(cashTransactionsTable)
        .where(eq(cashTransactionsTable.id, cashTransactionId))
        .for("update");
      if (!cash) return "missing-cash" as const;
      if (bank.cashTransactionId !== null || bank.transferredAt !== null) {
        return bank.cashTransactionId === cashTransactionId
          && bank.journalEntryId !== null
          && cash.journalEntryId === bank.journalEntryId
          ? bank
          : "resolved" as const;
      }
      if (bank.journalEntryId !== null || bank.unclearAt !== null) return "resolved" as const;
      if (cash.type !== bank.type) return "type-mismatch" as const;
      if (Number(cash.amount) !== Number(bank.amount)) return "amount-mismatch" as const;
      if (cash.sourceType !== null) return "cash-source-managed" as const;
      if (cash.bankTransactionId !== null) return "cash-linked" as const;
      const [closed] = await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(eq(cashClosuresTable.date, String(cash.date)));
      if (closed) return "closed" as const;
      const verifiedAt = new Date();
      const [linkedCash] = await tx.update(cashTransactionsTable)
        .set({
          bankTransactionId: id,
          bankVerifiedAt: verifiedAt,
          sourceType: "bank_transaction",
          sourceKey: `bank:${id}`,
        })
        .where(and(eq(cashTransactionsTable.id, cashTransactionId), isNull(cashTransactionsTable.bankTransactionId)))
        .returning({ id: cashTransactionsTable.id });
      if (!linkedCash) throw new BankCashLinkConflictError();
      const [linkedBank] = await tx.update(bankTransactionsTable)
        .set({ cashTransactionId, transferredAt: verifiedAt })
        .where(and(eq(bankTransactionsTable.id, id), isNull(bankTransactionsTable.cashTransactionId), isNull(bankTransactionsTable.transferredAt)))
        .returning();
      if (!linkedBank) throw new BankCashLinkConflictError();
       if (cash.journalEntryId) {
         await voidJournalEntry(tx, { journalEntryId: cash.journalEntryId, voidedBy: null });
       }
       const mapped = cash.accountId
         ? (await tx.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, cash.accountId)))[0]
         : null;
       const counter = await counterAccount(tx, cash.type, cash.category, mapped);
       const journalEntryId = await postBankCashJournal(tx, bank, { ...cash, bankTransactionId: id }, counter);
       await tx.update(cashTransactionsTable).set({ journalEntryId }).where(eq(cashTransactionsTable.id, cashTransactionId));
       const [postedBank] = await tx.update(bankTransactionsTable)
         .set({ journalEntryId })
         .where(eq(bankTransactionsTable.id, id))
         .returning();
       await syncOperatingExpenseForBankCash(tx, id, cash.id);
      return postedBank;
    });
    if (result === "missing-bank" || result === "missing-cash") {
      res.status(404).json({ error: result === "missing-bank" ? "Банкны гүйлгээ олдсонгүй" : "Кассын гүйлгээ олдсонгүй" });
      return;
    }
    if (typeof result === "string") {
      const errors = {
        resolved: "Банкны гүйлгээ аль хэдийн холбогдсон байна",
        "type-mismatch": "Банк болон кассын гүйлгээний төрөл таарахгүй байна",
         "amount-mismatch": "Банк болон кассын гүйлгээний дүн яг ижил байх шаардлагатай",
         "cash-source-managed": "Автомат үүссэн кассын гүйлгээг эх үүсвэрийн цэснээс банкны гүйлгээтэй холбоно уу",
        "cash-linked": "Кассын гүйлгээ аль хэдийн банкны гүйлгээнд холбогдсон байна",
        closed: "Өндөрлөсөн өдрийн кассын гүйлгээг холбох боломжгүй",
      };
      res.status(409).json({ error: errors[result] });
      return;
    }
    res.json(LinkBankTransactionToCashResponse.parse(await responseWithAccount(result)));
  } catch (error) {
    const databaseCode = (error as { code?: string; cause?: { code?: string } }).code
      ?? (error as { cause?: { code?: string } }).cause?.code;
    if (error instanceof BankCashLinkConflictError || databaseCode === "23505") {
      const { id } = LinkBankTransactionToCashParams.parse(req.params);
      const { cashTransactionId } = LinkBankTransactionToCashBody.parse(req.body);
      const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
      if (bank?.cashTransactionId === cashTransactionId && bank.transferredAt !== null) {
        res.json(LinkBankTransactionToCashResponse.parse(await responseWithAccount(bank)));
        return;
      }
      res.status(409).json({ error: "Банк эсвэл кассын гүйлгээ аль хэдийн холбогдсон байна" });
      return;
    }
    next(error);
  }
});

router.delete("/bank-transactions/:id", async (req, res, next) => {
  try {
    const { id } = DeleteBankTransactionParams.parse(req.params);
    const session = await getStaffSession(req);
    if (session?.role !== "admin") {
      const requestId = Number(req.header("x-deletion-request-id"));
      const [request] = Number.isInteger(requestId) ? await db.select().from(deletionRequestsTable).where(eq(deletionRequestsTable.id, requestId)) : [];
      if (!request || request.status !== "executing" || request.targetPath !== req.url) {
        res.status(403).json({ error: "Устгах үйлдэлд админы баталсан хүсэлт шаардлагатай" });
        return;
      }
    }
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(bankTransactionsTable)
        .where(eq(bankTransactionsTable.id, id))
        .for("update");
      if (!existing) return "missing" as const;
      if (existing.transferredAt || existing.cashTransactionId || existing.journalEntryId) {
        return "resolved" as const;
      }
      await tx.delete(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
      return "deleted" as const;
    });
    if (result === "missing") {
      res.status(404).json({ error: "Банкны гүйлгээ олдсонгүй" });
      return;
    }
    if (result === "resolved") {
      res.status(409).json({ error: "Касс эсвэл журналтай холбогдсон банкны гүйлгээг устгах боломжгүй" });
      return;
    }
    res.status(204).send();
  } catch (error) { next(error); }
});

router.get("/unclear-transactions", async (req, res, next) => {
  try {
    const session = await getStaffSession(req);
    if (session?.role !== "admin") {
      res.status(403).json({ error: "Зөвхөн админ тодорхойгүй гүйлгээг харах эрхтэй" });
      return;
    }
    const [banks, cash] = await Promise.all([
      db.select().from(bankTransactionsTable).where(isNotNull(bankTransactionsTable.unclearAt)).orderBy(desc(bankTransactionsTable.unclearAt)),
      db.select().from(cashTransactionsTable).where(isNotNull(cashTransactionsTable.unclearAt)).orderBy(desc(cashTransactionsTable.unclearAt)),
    ]);
    const rows = [
      ...banks.map((row) => ({
        id: row.id, source: "bank" as const, type: row.type as "income" | "expense",
        description: row.description, amount: Number(row.amount), occurredAt: row.transactionAt.toISOString(),
        account: row.account, category: null, unclearAt: row.unclearAt!.toISOString(),
      })),
      ...cash.map((row) => ({
        id: row.id, source: "cash" as const, type: row.type as "income" | "expense",
        description: row.description, amount: Number(row.amount), occurredAt: String(row.date),
        account: null, category: row.category, unclearAt: row.unclearAt!.toISOString(),
      })),
    ].sort((left, right) => right.unclearAt.localeCompare(left.unclearAt));
    res.json(ListUnclearTransactionsResponse.parse(rows));
  } catch (error) { next(error); }
});

router.post("/unclear-transactions/:source/:id", async (req, res, next) => {
  try {
    const session = await getStaffSession(req);
    if (session?.role !== "admin") {
      res.status(403).json({ error: "Зөвхөн админ гүйлгээг тодорхойгүй болгох эрхтэй" });
      return;
    }
    const { source, id } = MarkTransactionUnclearParams.parse(req.params);
    const table = source === "bank" ? bankTransactionsTable : cashTransactionsTable;
    const [updated] = await db.update(table).set({ unclearAt: new Date() }).where(eq(table.id, id)).returning({ id: table.id });
    if (!updated) {
      res.status(404).json({ error: "Гүйлгээ олдсонгүй" });
      return;
    }
    res.status(204).send();
  } catch (error) { next(error); }
});

export default router;