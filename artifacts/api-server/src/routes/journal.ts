import { Router, type IRouter } from "express";
import {
  CreateJournalEntryBody, CreateJournalEntryResponse, GetJournalEntryParams, GetJournalEntryResponse,
  ListJournalEntriesQueryParams, ListJournalEntriesResponse, UpdateJournalEntryBody, UpdateJournalEntryParams,
  UpdateJournalEntryResponse, VoidJournalEntryParams, VoidJournalEntryResponse, DeleteJournalEntryParams,
  GetJournalAccountLedgerParams, GetJournalAccountLedgerResponse, GetJournalTrialBalanceResponse,
  ListJournalReceivablesQueryParams, ListJournalReceivablesResponse, ListJournalSuppliersResponse,
} from "@workspace/api-zod";
import { and, asc, desc, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { db, bankTransactionsTable, cashTransactionsTable, chartOfAccountsTable, journalEntriesTable, journalLinesTable, receivablesTable, receivableAllocationsTable, employeesTable, inventorySuppliersTable, type JournalEntry, type JournalLine } from "@workspace/db";
import { getStaffSession } from "../lib/hr-session.js";
import {
  JournalValidationError, postJournalEntry, voidJournalEntry,
} from "../lib/journal-posting.js";

const router: IRouter = Router();
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Invalid journal entry";
function journalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new JournalValidationError("Journal date must use YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new JournalValidationError("Journal date is not a valid calendar date");
  }
  return value;
}
type JournalEntryWithLines = JournalEntry & { lines: JournalLine[]; totalDebit: number; totalCredit: number };
function entryWithLines(entry: JournalEntry, lines: JournalLine[]): JournalEntryWithLines {
  return {
    ...entry,
    lines,
    totalDebit: lines.reduce((sum, line) => sum + Number(line.debit), 0),
    totalCredit: lines.reduce((sum, line) => sum + Number(line.credit), 0),
  };
}
async function loadEntry(id: number): Promise<JournalEntryWithLines | null> {
  const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, id));
  if (!entry) return null;
  const lines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, id)).orderBy(journalLinesTable.id);
  return entryWithLines(entry, lines);
}

router.get("/journal/entries", async (req, res, next) => {
  try {
    const raw = ListJournalEntriesQueryParams.parse(req.query);
    const filters = [];
    if (raw.dateFrom) filters.push(gte(journalEntriesTable.date, journalDate(raw.dateFrom)));
    if (raw.dateTo) filters.push(lte(journalEntriesTable.date, journalDate(raw.dateTo)));
    if (raw.sourceType) filters.push(eq(journalEntriesTable.sourceType, raw.sourceType));
    if (raw.status) filters.push(eq(journalEntriesTable.status, raw.status));
    if (raw.accountId) {
      const ids = await db.select({ id: journalLinesTable.journalEntryId }).from(journalLinesTable).where(eq(journalLinesTable.accountId, raw.accountId));
      filters.push(inArray(journalEntriesTable.id, ids.map((row) => row.id)));
    }
    const rows = await db.select().from(journalEntriesTable).where(filters.length ? and(...filters) : undefined).orderBy(desc(journalEntriesTable.date), desc(journalEntriesTable.id));
    const totals = rows.length
      ? await db.select({
        journalEntryId: journalLinesTable.journalEntryId,
        totalDebit: sql<number>`coalesce(sum(${journalLinesTable.debit}), 0)::double precision`,
        totalCredit: sql<number>`coalesce(sum(${journalLinesTable.credit}), 0)::double precision`,
      }).from(journalLinesTable)
        .where(inArray(journalLinesTable.journalEntryId, rows.map((row) => row.id)))
        .groupBy(journalLinesTable.journalEntryId)
      : [];
    const totalByEntry = new Map(totals.map((total) => [total.journalEntryId, total]));
    res.json(ListJournalEntriesResponse.parse(rows.map((row) => ({
      ...row,
      totalDebit: Number(totalByEntry.get(row.id)?.totalDebit ?? 0),
      totalCredit: Number(totalByEntry.get(row.id)?.totalCredit ?? 0),
    }))));
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) return res.status(Number(error.status)).json({ error: errorMessage(error) });
    if (error instanceof JournalValidationError) return res.status(400).json({ error: error.message });
    return next(error);
  }
});

router.get("/journal/receivables", async (req, res, next) => {
  try {
    const { status = "open" } = ListJournalReceivablesQueryParams.parse(req.query);
    const filters = status === "all" ? undefined : eq(receivablesTable.status, status);
    const rows = await db.select({
      id: receivablesTable.id,
      originJournalEntryId: receivablesTable.originJournalEntryId,
      originJournalLineId: receivablesTable.originJournalLineId,
      employeeId: receivablesTable.employeeId,
      supplierId: receivablesTable.supplierId,
      originalAmount: receivablesTable.originalAmount,
      openAmount: receivablesTable.openAmount,
      status: receivablesTable.status,
      createdAt: receivablesTable.createdAt,
      employeeName: employeesTable.name,
      supplierName: inventorySuppliersTable.name,
    }).from(receivablesTable)
      .leftJoin(employeesTable, eq(employeesTable.id, receivablesTable.employeeId))
      .leftJoin(inventorySuppliersTable, eq(inventorySuppliersTable.id, receivablesTable.supplierId))
      .where(filters).orderBy(desc(receivablesTable.createdAt));
    return res.json(ListJournalReceivablesResponse.parse(rows.map((row) => ({
      ...row,
      partyType: row.employeeId ? "employee" : "supplier",
      partyId: row.employeeId ?? row.supplierId!,
      partyLabel: row.employeeName ?? row.supplierName!,
    }))));
  } catch (error) { return next(error); }
});

router.get("/journal/suppliers", async (_req, res, next) => {
  try {
    const rows = await db.select({ id: inventorySuppliersTable.id, name: inventorySuppliersTable.name })
      .from(inventorySuppliersTable).orderBy(asc(inventorySuppliersTable.name));
    return res.json(ListJournalSuppliersResponse.parse(rows));
  } catch (error) { return next(error); }
});

router.get("/journal/entries/:id", async (req, res, next) => {
  try {
    const { id } = GetJournalEntryParams.parse(req.params);
    const result = await loadEntry(id);
    if (!result) return res.status(404).json({ error: "Journal entry not found" });
    return res.json(GetJournalEntryResponse.parse(result));
  } catch (error) { return next(error); }
});

router.post("/journal/entries", async (req, res, next) => {
  try {
    const body = CreateJournalEntryBody.parse(req.body);
    const session = await getStaffSession(req);
    const result = await db.transaction((tx) => postJournalEntry(tx, {
      date: journalDate(body.date), description: body.description, sourceType: "manual", sourceId: null,
      createdBy: session?.id ?? null, lines: body.lines,
    }));
    const entry = await loadEntry(result.journalEntryId);
    return res.status(201).json(CreateJournalEntryResponse.parse(entry));
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) return res.status(Number(error.status)).json({ error: errorMessage(error) });
    if (error instanceof JournalValidationError) return res.status(400).json({ error: error.message });
    return next(error);
  }
});

router.put("/journal/entries/:id", async (req, res, next) => {
  try {
    const { id } = UpdateJournalEntryParams.parse(req.params);
    const body = UpdateJournalEntryBody.parse(req.body);
    await db.transaction(async (tx) => {
      const [entry] = await tx.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, id)).for("update");
      if (!entry) throw Object.assign(new Error("Journal entry not found"), { status: 404 });
      if (entry.status !== "draft") throw Object.assign(new Error("Only draft journal entries can be updated"), { status: 409 });
      return postJournalEntry(tx, {
        journalEntryId: id,
        date: entry.date,
        description: entry.description,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        createdBy: entry.createdBy,
        lines: body.lines,
      });
    });
    const entry = await loadEntry(id);
    return res.json(UpdateJournalEntryResponse.parse(entry));
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) return res.status(Number(error.status)).json({ error: errorMessage(error) });
    if (error instanceof JournalValidationError) return res.status(400).json({ error: error.message });
    return next(error);
  }
});

router.delete("/journal/entries/:id", async (req, res, next) => {
  try {
    const { id } = DeleteJournalEntryParams.parse(req.params);
    const result = await db.transaction(async (tx) => {
      const [entry] = await tx.select({ id: journalEntriesTable.id })
        .from(journalEntriesTable)
        .where(eq(journalEntriesTable.id, id))
        .for("update");
      if (!entry) return "missing" as const;
      const [[originReceivable], [settlementAllocation]] = await Promise.all([
        tx.select({ id: receivablesTable.id })
          .from(receivablesTable)
          .where(eq(receivablesTable.originJournalEntryId, id))
          .limit(1),
        tx.select({ id: receivableAllocationsTable.id })
          .from(receivableAllocationsTable)
          .where(eq(receivableAllocationsTable.settlementJournalEntryId, id))
          .limit(1),
      ]);
      if (originReceivable || settlementAllocation) return "receivable_linked" as const;
      await tx.delete(journalEntriesTable).where(eq(journalEntriesTable.id, id));
      return "deleted" as const;
    });
    if (result === "missing") return res.status(404).json({ error: "Journal entry not found" });
    if (result === "receivable_linked") {
      return res.status(409).json({ error: "Авлагатай холбоотой журналыг шууд устгах боломжгүй" });
    }
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

router.post("/journal/entries/:id/void", async (req, res, next) => {
  try {
    const { id } = VoidJournalEntryParams.parse(req.params);
    const [[bankOwner], [cashOwner]] = await Promise.all([
      db.select({ id: bankTransactionsTable.id }).from(bankTransactionsTable).where(eq(bankTransactionsTable.journalEntryId, id)).limit(1),
      db.select({ id: cashTransactionsTable.id }).from(cashTransactionsTable).where(eq(cashTransactionsTable.journalEntryId, id)).limit(1),
    ]);
    if (bankOwner || cashOwner) {
      return res.status(409).json({ error: "Энэ журнал банк эсвэл кассын гүйлгээтэй холбоотой тул эх үүсвэр цэснээс өөрчилнө үү" });
    }
    const session = await getStaffSession(req);
    const result = await db.transaction((tx) => voidJournalEntry(tx, { journalEntryId: id, voidedBy: session?.id ?? null }));
    return res.json(VoidJournalEntryResponse.parse(result));
  } catch (error) {
    const message = errorMessage(error);
    if (error && typeof error === "object" && "status" in error) {
      return res.status(Number(error.status)).json({ error: message });
    }
    if (message === "Journal entry not found") return res.status(404).json({ error: message });
    if (message === "Only a posted journal entry can be voided") return res.status(409).json({ error: message });
    return next(error);
  }
});

const cents = (value: number) => BigInt(Math.round(value * 100));
const amount = (value: bigint) => Number(value) / 100;

router.get("/journal/accounts/:id/ledger", async (req, res, next) => {
  try {
    const { id } = GetJournalAccountLedgerParams.parse(req.params);
    const [account] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, id));
    if (!account) return res.status(404).json({ error: "Account not found" });
    const rows = await db.select({
      date: journalEntriesTable.date, journalEntryId: journalEntriesTable.id, lineId: journalLinesTable.id,
      debit: journalLinesTable.debit, credit: journalLinesTable.credit,
    }).from(journalLinesTable)
      .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.journalEntryId))
      .where(and(eq(journalLinesTable.accountId, id), inArray(journalEntriesTable.status, ["posted", "void"])))
      .orderBy(asc(journalEntriesTable.date), asc(journalEntriesTable.id), asc(journalLinesTable.id));
    const grouped = new Map<number, { date: string; journalEntryId: number; debit: bigint; credit: bigint }>();
    for (const row of rows) {
      const current = grouped.get(row.journalEntryId);
      if (current) {
        current.debit += cents(row.debit);
        current.credit += cents(row.credit);
      } else grouped.set(row.journalEntryId, {
        date: row.date, journalEntryId: row.journalEntryId, debit: cents(row.debit), credit: cents(row.credit),
      });
    }
    let running = 0n;
    const entries = [...grouped.values()].map((row) => {
      running += account.normalBalance === "credit" ? row.credit - row.debit : row.debit - row.credit;
      return { date: row.date, journalEntryId: row.journalEntryId, debit: amount(row.debit), credit: amount(row.credit), balance: amount(running) };
    });
    return res.json(GetJournalAccountLedgerResponse.parse({
      accountId: id, code: account.code, name: account.name, normalBalance: account.normalBalance, entries,
    }));
  } catch (error) { return next(error); }
});

router.get("/journal/trial-balance", async (_req, res, next) => {
  try {
    const rows = await db.select({
      accountId: chartOfAccountsTable.id, code: chartOfAccountsTable.code, name: chartOfAccountsTable.name,
      normalBalance: chartOfAccountsTable.normalBalance, debit: journalLinesTable.debit, credit: journalLinesTable.credit,
    }).from(journalLinesTable)
      .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.journalEntryId))
      .innerJoin(chartOfAccountsTable, eq(chartOfAccountsTable.id, journalLinesTable.accountId))
      .where(inArray(journalEntriesTable.status, ["posted", "void"]));
    const totals = new Map<number, { accountId: number; code: string; name: string; normalBalance: string; debit: bigint; credit: bigint }>();
    for (const row of rows) {
      const current = totals.get(row.accountId) ?? {
        accountId: row.accountId, code: row.code, name: row.name, normalBalance: row.normalBalance, debit: 0n, credit: 0n,
      };
      current.debit += cents(row.debit); current.credit += cents(row.credit); totals.set(row.accountId, current);
    }
    const accountTotals = [...totals.values()].sort((a, b) => a.accountId - b.accountId);
    const totalDebit = accountTotals.reduce((sum, row) => sum + row.debit, 0n);
    const totalCredit = accountTotals.reduce((sum, row) => sum + row.credit, 0n);
    const accounts = accountTotals.map((row) => ({
      accountId: row.accountId, code: row.code, name: row.name, normalBalance: row.normalBalance,
      debit: amount(row.debit), credit: amount(row.credit),
      balance: amount(row.normalBalance === "credit" ? row.credit - row.debit : row.debit - row.credit),
    }));
    return res.json(GetJournalTrialBalanceResponse.parse({
      balanced: totalDebit === totalCredit, totalDebit: amount(totalDebit), totalCredit: amount(totalCredit), accounts,
    }));
  } catch (error) { return next(error); }
});

export default router;