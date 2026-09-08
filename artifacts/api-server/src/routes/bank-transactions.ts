import { Router, raw, type IRouter } from "express";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  DeleteBankTransactionParams,
  CreateBankAccountBody,
  CreateBankAccountResponse,
  ImportKapitronBankTransactionsResponse,
  ImportKapitronBankTransactionsQueryParams,
  LinkBankTransactionToCashBody,
  LinkBankTransactionToCashParams,
  LinkBankTransactionToCashResponse,
  ListBankTransactionCashSuggestionsParams,
  ListBankTransactionCashSuggestionsResponse,
  ListBankTransactionsResponse,
  ListBankAccountsResponse,
  ListUnclearTransactionsResponse,
  MarkTransactionUnclearParams,
  TransferBankTransactionToCashBody,
  TransferBankTransactionToCashParams,
  TransferBankTransactionToCashResponse,
} from "@workspace/api-zod";
import { and, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { bankAccountsTable, bankTransactionsTable, cashClosuresTable, cashTransactionsTable, db, deletionRequestsTable } from "@workspace/db";
import { getStaffSession } from "../lib/hr-session";

const router: IRouter = Router();
const execFile = promisify(execFileCallback);
const maxUploadBytes = 10 * 1024 * 1024;
const maxXmlBytes = 8 * 1024 * 1024;
const maxRows = 20_000;
const requiredHeaders = ["Огноо", "Зарлага", "Орлого", "Exchange", "Харьцсан данс / Нэр", "Үлдэгдэл", "Гүйлгээний утга", "Гүйлгээ хийсэн огноо"];

class BankCashLinkConflictError extends Error {}

router.use(async (req, res, next) => {
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
  return {
    id: row.id,
    type: row.type as "income" | "expense",
    category: row.category,
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

async function readXlsx(buffer: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "kapitron-"));
  try {
    const input = join(directory, "statement.xlsx");
    await writeFile(input, buffer, { mode: 0o600 });
    const { stdout: listing } = await execFile("unzip", ["-Z", "-1", input], { maxBuffer: 256 * 1024 });
    const names = listing.split(/\r?\n/);
    const sheet = names.find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
    if (!sheet || !names.includes("xl/sharedStrings.xml")) throw new Error("Kapitron XLSX бүтэц буруу байна");
    const [strings, worksheet] = await Promise.all(["xl/sharedStrings.xml", sheet].map(async (name) => {
      const { stdout } = await execFile("unzip", ["-p", input, name], { encoding: "utf8", maxBuffer: maxXmlBytes });
      return stdout;
    }));
    const shared = [...strings.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
      [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join(""));
    const rows = [...worksheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)];
    if (rows.length > maxRows + 1) throw new Error("XLSX мөрийн тоо хэт их байна");
    const header = cellsFromRow(rows[0]?.[1] ?? "", shared);
    const indexes = new Map(requiredHeaders.map((name) => [name, [...header].find(([, value]) => value.trim() === name)?.[0]]));
    if ([...indexes.values()].some((index) => index === undefined)) throw new Error("Kapitron баганын толгой буруу байна");
    return rows.slice(1).map((row) => cellsFromRow(row[1], shared)).map((cells) => Object.fromEntries(
      requiredHeaders.map((name) => [name, cells.get(indexes.get(name)!)?.trim() ?? ""]),
    ));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const response = (row: typeof bankTransactionsTable.$inferSelect) => ({
  id: row.id, transactionAt: row.transactionAt.toISOString(), type: row.type as "income" | "expense",
  amount: Number(row.amount), account: row.account, counterparty: row.counterparty, description: row.description,
  executedAt: row.executedAt?.toISOString() ?? null, balance: row.balance === null ? null : Number(row.balance),
  transferredAt: row.transferredAt?.toISOString() ?? null, cashTransactionId: row.cashTransactionId,
  bankAccountId: row.bankAccountId, bankName: row.bankName, bankAccountNumber: row.bankAccountNumber,
  createdAt: row.createdAt.toISOString(),
});

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
    const rows = await db.select().from(bankTransactionsTable)
      .where(and(isNull(bankTransactionsTable.cashTransactionId), isNull(bankTransactionsTable.transferredAt), isNull(bankTransactionsTable.unclearAt)))
      .orderBy(desc(bankTransactionsTable.transactionAt), desc(bankTransactionsTable.id));
    res.json(ListBankTransactionsResponse.parse(rows.map(response)));
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
    const rows = await readXlsx(req.body);
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
          pending.push(value);
        }
      }
      return pending.length
        ? await tx.insert(bankTransactionsTable).values(pending).onConflictDoNothing().returning({ id: bankTransactionsTable.id })
        : [];
    });
    res.status(201).json(ImportKapitronBankTransactionsResponse.parse({
      imported: inserted.length,
      skippedDuplicate: values.length - inserted.length,
      skippedZero,
    }));
  } catch (error) { next(error); }
});

router.post("/bank-transactions/:id/transfer-to-cash", async (req, res, next) => {
  try {
    const { id } = TransferBankTransactionToCashParams.parse(req.params);
    const { category, incomeMonth } = TransferBankTransactionToCashBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [bank] = await tx.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
      if (!bank) return null;
      if (bank.cashTransactionId !== null || bank.transferredAt !== null) {
        return bank;
      }
      if (bank.type === "income" && incomeMonth === null) return "income_month_required" as const;
      const date = bank.transactionAt.toISOString().slice(0, 10);
      const [closed] = await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(eq(cashClosuresTable.date, date));
      if (closed) return "closed" as const;
      const verifiedAt = new Date();
      const [cash] = await tx.insert(cashTransactionsTable).values({
        type: bank.type,
        category,
        description: bank.description,
        amount: bank.amount,
        date,
        incomeMonth: bank.type === "income" ? incomeMonth : null,
        sourceType: "bank_transaction",
        sourceKey: String(id),
        bankTransactionId: id,
        bankVerifiedAt: verifiedAt,
      }).onConflictDoNothing().returning({ id: cashTransactionsTable.id });
      if (!cash) throw new BankCashLinkConflictError();
      const [updated] = await tx.update(bankTransactionsTable)
        .set({ transferredAt: verifiedAt, cashTransactionId: cash.id })
        .where(and(eq(bankTransactionsTable.id, id), isNull(bankTransactionsTable.cashTransactionId), isNull(bankTransactionsTable.transferredAt)))
        .returning();
      if (!updated) throw new BankCashLinkConflictError();
      return updated;
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
    res.json(TransferBankTransactionToCashResponse.parse(response(result)));
  } catch (error) {
    if (error instanceof BankCashLinkConflictError || (error as { code?: string }).code === "23505") {
      const { id } = TransferBankTransactionToCashParams.parse(req.params);
      const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
      if (bank && (bank.cashTransactionId !== null || bank.transferredAt !== null)) {
        res.json(TransferBankTransactionToCashResponse.parse(response(bank)));
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
      isNull(cashTransactionsTable.unclearAt),
      gte(cashTransactionsTable.date, calendarDateOffset(bankDate, -7)),
      lte(cashTransactionsTable.date, calendarDateOffset(bankDate, 7)),
    ));
    const suggestions = candidates.map((cash) => ({ cash, score: suggestionScore(bank, cash) }))
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
      const [[bank], [cash]] = await Promise.all([
        tx.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id)),
        tx.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cashTransactionId)),
      ]);
      if (!bank) return "missing-bank" as const;
      if (!cash) return "missing-cash" as const;
      if (bank.cashTransactionId !== null || bank.transferredAt !== null) {
        return bank.cashTransactionId === cashTransactionId ? bank : "resolved" as const;
      }
      if (cash.type !== bank.type) return "type-mismatch" as const;
      if (cash.bankTransactionId !== null) return "cash-linked" as const;
      const [closed] = await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(eq(cashClosuresTable.date, String(cash.date)));
      if (closed) return "closed" as const;
      const verifiedAt = new Date();
      const [linkedCash] = await tx.update(cashTransactionsTable)
        .set({ bankTransactionId: id, bankVerifiedAt: verifiedAt })
        .where(and(eq(cashTransactionsTable.id, cashTransactionId), isNull(cashTransactionsTable.bankTransactionId)))
        .returning({ id: cashTransactionsTable.id });
      if (!linkedCash) throw new BankCashLinkConflictError();
      const [linkedBank] = await tx.update(bankTransactionsTable)
        .set({ cashTransactionId, transferredAt: verifiedAt })
        .where(and(eq(bankTransactionsTable.id, id), isNull(bankTransactionsTable.cashTransactionId), isNull(bankTransactionsTable.transferredAt)))
        .returning();
      if (!linkedBank) throw new BankCashLinkConflictError();
      return linkedBank;
    });
    if (result === "missing-bank" || result === "missing-cash") {
      res.status(404).json({ error: result === "missing-bank" ? "Банкны гүйлгээ олдсонгүй" : "Кассын гүйлгээ олдсонгүй" });
      return;
    }
    if (typeof result === "string") {
      const errors = {
        resolved: "Банкны гүйлгээ аль хэдийн холбогдсон байна",
        "type-mismatch": "Банк болон кассын гүйлгээний төрөл таарахгүй байна",
        "cash-linked": "Кассын гүйлгээ аль хэдийн банкны гүйлгээнд холбогдсон байна",
        closed: "Өндөрлөсөн өдрийн кассын гүйлгээг холбох боломжгүй",
      };
      res.status(409).json({ error: errors[result] });
      return;
    }
    res.json(LinkBankTransactionToCashResponse.parse(response(result)));
  } catch (error) {
    if (error instanceof BankCashLinkConflictError || (error as { code?: string }).code === "23505") {
      const { id } = LinkBankTransactionToCashParams.parse(req.params);
      const { cashTransactionId } = LinkBankTransactionToCashBody.parse(req.body);
      const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
      if (bank?.cashTransactionId === cashTransactionId && bank.transferredAt !== null) {
        res.json(LinkBankTransactionToCashResponse.parse(response(bank)));
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
    const [existing] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Банкны гүйлгээ олдсонгүй" });
      return;
    }
    if (existing.transferredAt || existing.cashTransactionId) {
      res.status(409).json({ error: "Касс руу шилжүүлсэн банкны гүйлгээг устгах боломжгүй" });
      return;
    }
    await db.delete(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
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