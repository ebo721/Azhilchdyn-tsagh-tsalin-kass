import { Router, type IRouter } from "express";
import {
  CreateJournalEntryBody, CreateJournalEntryResponse, GetJournalEntryParams, GetJournalEntryResponse,
  ListJournalEntriesQueryParams, ListJournalEntriesResponse, UpdateJournalEntryBody, UpdateJournalEntryParams,
  UpdateJournalEntryResponse, VoidJournalEntryParams, VoidJournalEntryResponse,
} from "@workspace/api-zod";
import { and, desc, eq, gte, lte, inArray } from "drizzle-orm";
import { db, journalEntriesTable, journalLinesTable, type JournalEntry, type JournalLine } from "@workspace/db";
import { getStaffSession } from "../lib/hr-session.js";
import { postJournalEntry, validateAndNormalizeJournalLines, voidJournalEntry } from "../lib/journal-posting.js";

const router: IRouter = Router();
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Invalid journal entry";
function dateText(value: Date) { return value.toISOString().slice(0, 10); }
type JournalEntryWithLines = JournalEntry & { lines: JournalLine[] };
function entryWithLines(entry: JournalEntry, lines: JournalLine[]): JournalEntryWithLines {
  return { ...entry, lines };
}
async function loadEntry(id: number): Promise<JournalEntryWithLines | null> {
  const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, id));
  if (!entry) return null;
  const lines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, id)).orderBy(journalLinesTable.id);
  return entryWithLines(entry, lines);
}

router.get("/journal/entries", async (req, res, next) => {
  try {
    const raw = ListJournalEntriesQueryParams.parse({
      ...req.query,
      dateFrom: req.query.dateFrom ? new Date(String(req.query.dateFrom)) : undefined,
      dateTo: req.query.dateTo ? new Date(String(req.query.dateTo)) : undefined,
    });
    const filters = [];
    if (raw.dateFrom) filters.push(gte(journalEntriesTable.date, dateText(raw.dateFrom)));
    if (raw.dateTo) filters.push(lte(journalEntriesTable.date, dateText(raw.dateTo)));
    if (raw.sourceType) filters.push(eq(journalEntriesTable.sourceType, raw.sourceType));
    if (raw.status) filters.push(eq(journalEntriesTable.status, raw.status));
    if (raw.accountId) {
      const ids = await db.select({ id: journalLinesTable.journalEntryId }).from(journalLinesTable).where(eq(journalLinesTable.accountId, raw.accountId));
      filters.push(inArray(journalEntriesTable.id, ids.map((row) => row.id)));
    }
    const rows = await db.select().from(journalEntriesTable).where(filters.length ? and(...filters) : undefined).orderBy(desc(journalEntriesTable.date), desc(journalEntriesTable.id));
    res.json(ListJournalEntriesResponse.parse(rows));
  } catch (error) { next(error); }
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
      date: dateText(body.date), description: body.description, sourceType: "manual", sourceId: null,
      createdBy: session?.id ?? null, lines: body.lines,
    }));
    const entry = await loadEntry(result.journalEntryId);
    return res.status(201).json(CreateJournalEntryResponse.parse(entry));
  } catch (error) { return next(error); }
});

router.put("/journal/entries/:id", async (req, res, next) => {
  try {
    const { id } = UpdateJournalEntryParams.parse(req.params);
    const body = UpdateJournalEntryBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [entry] = await tx.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, id)).for("update");
      if (!entry) throw Object.assign(new Error("Journal entry not found"), { status: 404 });
      if (entry.status !== "draft") throw Object.assign(new Error("Only draft journal entries can be updated"), { status: 409 });
      const normalized = await validateAndNormalizeJournalLines(tx, body.lines);
      await tx.delete(journalLinesTable).where(eq(journalLinesTable.journalEntryId, id));
      await tx.insert(journalLinesTable).values(normalized.lines.map((line) => ({
        journalEntryId: id, accountId: line.accountId, debit: line.debitCents / 100, credit: line.creditCents / 100, memo: line.memo ?? null,
      })));
      await tx.update(journalEntriesTable).set({ status: normalized.status }).where(eq(journalEntriesTable.id, id));
      return normalized.status;
    });
    const entry = await loadEntry(id);
    return res.json(UpdateJournalEntryResponse.parse(entry));
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) return res.status(Number(error.status)).json({ error: errorMessage(error) });
    return next(error);
  }
});

router.post("/journal/entries/:id/void", async (req, res, next) => {
  try {
    const { id } = VoidJournalEntryParams.parse(req.params);
    const session = await getStaffSession(req);
    const result = await db.transaction((tx) => voidJournalEntry(tx, { journalEntryId: id, voidedBy: session?.id ?? null }));
    return res.json(VoidJournalEntryResponse.parse(result));
  } catch (error) {
    const message = errorMessage(error);
    if (message === "Journal entry not found") return res.status(404).json({ error: message });
    if (message === "Only a posted journal entry can be voided") return res.status(409).json({ error: message });
    return next(error);
  }
});

export default router;