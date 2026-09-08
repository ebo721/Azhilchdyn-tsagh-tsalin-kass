import { Router, raw, type IRouter } from "express";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  DeleteBankTransactionParams,
  ImportKapitronBankTransactionsResponse,
  ListBankTransactionsResponse,
  ListBankTransactionCashSuggestionsParams,
  ListBankTransactionCashSuggestionsResponse,
  TransferBankTransactionToCashBody,
  TransferBankTransactionToCashParams,
  TransferBankTransactionToCashResponse,
} from "@workspace/api-zod";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { bankTransactionsTable, cashClosuresTable, cashTransactionsTable, db, deletionRequestsTable } from "@workspace/db";
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
  createdAt: row.createdAt.toISOString(),
});

router.get("/bank-transactions", async (_req, res, next) => {
  try {
    const rows = await db.select().from(bankTransactionsTable)
      .where(and(isNull(bankTransactionsTable.cashTransactionId), isNull(bankTransactionsTable.transferredAt)))
      .orderBy(desc(bankTransactionsTable.transactionAt), desc(bankTransactionsTable.id));
    res.json(ListBankTransactionsResponse.parse(rows.map(response)));
  } catch (error) { next(error); }
});

router.post("/bank-transactions/import", raw({ type: "application/octet-stream", limit: maxUploadBytes }), async (req, res, next) => {
  try {
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
      if (amount === 200 && description.toLocaleUpperCase("mn-MN").includes("ШИМТГЭЛ")) return [];
      const fingerprint = createHash("sha256").update(JSON.stringify([
        transactionAt.toISOString(),
        amount,
        account,
        description,
      ])).digest("hex");
      return [{ transactionAt, type, amount, account, counterparty: account, balance: row["Үлдэгдэл"] ? parseAmount(row["Үлдэгдэл"]) : null, description, executedAt: transactionAt, fingerprint }];
    });
    const inserted = await db.transaction(async (tx) => values.length
      ? await tx.insert(bankTransactionsTable).values(values).onConflictDoNothing().returning({ id: bankTransactionsTable.id })
      : []);
    res.status(201).json(ImportKapitronBankTransactionsResponse.parse({
      imported: inserted.length,
      skippedDuplicate: values.length - inserted.length,
      skippedZero,
    }));
  } catch (error) { next(error); }
});

function calendarDateDistance(first: string, second: string) {
  const asUtc = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.abs(asUtc(first) - asUtc(second)) / 86_400_000;
}

function descriptionTokens(value: string) {
  return new Set(value.toLocaleLowerCase("mn-MN").split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1));
}

function tokenOverlap(first: string, second: string) {
  const a = descriptionTokens(first);
  const b = descriptionTokens(second);
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : [...a].filter((token) => b.has(token)).length / union.size;
}

router.get("/bank-transactions/:id/cash-suggestions", async (req, res, next) => {
  try {
    const { id } = ListBankTransactionCashSuggestionsParams.parse(req.params);
    const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
    if (!bank) {
      res.status(404).json({ error: "Банкны гүйлгээ олдсонгүй" });
      return;
    }
    if (bank.cashTransactionId || bank.transferredAt) {
      res.json(ListBankTransactionCashSuggestionsResponse.parse([]));
      return;
    }
    const [cashRows, linkedRows] = await Promise.all([
      db.select().from(cashTransactionsTable).where(and(eq(cashTransactionsTable.type, bank.type), isNull(cashTransactionsTable.bankTransactionId))),
      db.select({ cashTransactionId: bankTransactionsTable.cashTransactionId }).from(bankTransactionsTable)
        .where(isNotNull(bankTransactionsTable.cashTransactionId)),
    ]);
    const linkedCashIds = new Set(linkedRows.map((row) => row.cashTransactionId!));
    const bankDate = bank.transactionAt.toISOString().slice(0, 10);
    const bankAmount = Number(bank.amount);
    const suggestions = cashRows
      .filter((cash) => !linkedCashIds.has(cash.id))
      .map((cash) => {
        const dateDistance = calendarDateDistance(bankDate, String(cash.date));
        const amountDifference = Math.abs(bankAmount - Number(cash.amount));
        const relativeAmountDifference = amountDifference / Math.max(bankAmount, Number(cash.amount), 1);
        const overlap = tokenOverlap(`${bank.counterparty} ${bank.description}`, cash.description);
        return { cash, dateDistance, amountDifference, relativeAmountDifference, overlap,
          score: Math.max(0, 100 - dateDistance * 8 - relativeAmountDifference * 40 - amountDifference / Math.max(bankAmount, 1) * 20 + overlap * 20) };
      })
      .filter((candidate) => candidate.dateDistance <= 7)
      .sort((a, b) => a.dateDistance - b.dateDistance
        || a.relativeAmountDifference - b.relativeAmountDifference
        || a.amountDifference - b.amountDifference
        || b.overlap - a.overlap)
      .slice(0, 10)
      .map(({ cash, score }) => ({
        id: cash.id, type: cash.type as "income" | "expense", category: cash.category, description: cash.description,
        amount: Number(cash.amount), date: String(cash.date), bankTransactionId: cash.bankTransactionId,
        bankVerifiedAt: cash.bankVerifiedAt?.toISOString() ?? null, createdAt: String(cash.createdAt),
        editable: cash.sourceType === null, transactionKind: cash.sourceType ?? "manual", score,
      }));
    res.json(ListBankTransactionCashSuggestionsResponse.parse(suggestions));
  } catch (error) { next(error); }
});

router.post("/bank-transactions/:id/transfer-to-cash", async (req, res, next) => {
  try {
    const { id } = TransferBankTransactionToCashParams.parse(req.params);
    const { cashTransactionId } = TransferBankTransactionToCashBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [bank] = await tx.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
      if (!bank) return null;
      if (bank.cashTransactionId !== null || bank.transferredAt !== null) {
        return bank.cashTransactionId === cashTransactionId ? bank : "conflict" as const;
      }
      const [cash] = await tx.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cashTransactionId));
      if (!cash) return "cash-not-found" as const;
      if (cash.type !== bank.type) return "type-mismatch" as const;
      if (cash.bankTransactionId !== null) return "conflict" as const;
      const [alreadyLinked] = await tx.select({ id: bankTransactionsTable.id }).from(bankTransactionsTable)
        .where(eq(bankTransactionsTable.cashTransactionId, cashTransactionId));
      if (alreadyLinked) return "conflict" as const;
      const [closed] = await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(eq(cashClosuresTable.date, String(cash.date)));
      if (closed) return "closed" as const;
      const verifiedAt = new Date();
      const [verifiedCash] = await tx.update(cashTransactionsTable)
        .set({ bankTransactionId: id, bankVerifiedAt: verifiedAt })
        .where(and(eq(cashTransactionsTable.id, cashTransactionId), isNull(cashTransactionsTable.bankTransactionId)))
        .returning({ id: cashTransactionsTable.id });
      if (!verifiedCash) throw new BankCashLinkConflictError();
      const [updated] = await tx.update(bankTransactionsTable)
        .set({ transferredAt: verifiedAt, cashTransactionId })
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
    if (result === "cash-not-found") {
      res.status(404).json({ error: "Кассын гүйлгээ олдсонгүй" });
      return;
    }
    if (result === "type-mismatch") {
      res.status(409).json({ error: "Банк болон кассын гүйлгээний төрөл таарахгүй байна" });
      return;
    }
    if (result === "conflict") {
      res.status(409).json({ error: "Банк эсвэл кассын гүйлгээ аль хэдийн холбогдсон байна" });
      return;
    }
    res.json(TransferBankTransactionToCashResponse.parse(response(result)));
  } catch (error) {
    if (error instanceof BankCashLinkConflictError || (error as { code?: string }).code === "23505") {
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

export default router;