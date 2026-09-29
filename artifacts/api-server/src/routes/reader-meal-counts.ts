import { Router, type IRouter } from "express";
import { and, asc, desc, gte, lte, sql } from "drizzle-orm";
import { db, mealCountsTable } from "@workspace/db";
import {
  ListMealCountsQueryParams,
  ListMealCountsResponse,
  ImportMealCountsBody,
  ImportMealCountsResponse,
} from "@workspace/api-zod";
import { isValidCalendarDate } from "../lib/route-shared.js";
import { getStaffSession } from "../lib/hr-session.js";

export const readerMealCountsStaffRouter: IRouter = Router();

function cleanMealType(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function dateOrdinal(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function isValidDateRange(dateFrom: string, dateTo: string) {
  if (!isValidCalendarDate(dateFrom) || !isValidCalendarDate(dateTo)) return false;
  const daySpan = dateOrdinal(dateTo) - dateOrdinal(dateFrom);
  return daySpan >= 0 && daySpan < 366;
}

function readerUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    const localTestHttp = process.env.NODE_ENV === "test"
      && url.protocol === "http:"
      && ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
    if (url.protocol !== "https:" && !localTestHttp) return null;
    return url;
  } catch {
    return null;
  }
}

function parseReaderRecords(payload: unknown): Array<{ date: string; mealType: string; count: number }> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const envelope = payload as Record<string, unknown>;
  if (Object.keys(envelope).length !== 1 || !Array.isArray(envelope.records) || envelope.records.length > 5000) return null;
  const records: Array<{ date: string; mealType: string; count: number }> = [];
  for (const value of envelope.records) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 3 || typeof record.date !== "string"
      || typeof record.mealType !== "string" || !record.mealType.trim()
      || typeof record.count !== "number" || !Number.isSafeInteger(record.count)
      || record.count < 0 || record.count > 2_147_483_647) return null;
    records.push({ date: record.date, mealType: record.mealType, count: record.count });
  }
  return records;
}

readerMealCountsStaffRouter.post("/meal-counts/import", async (req, res, next): Promise<void> => {
  const session = await getStaffSession(req);
  if (!session || (session.role !== "admin" && session.role !== "warehouse")) {
    res.status(session ? 403 : 401).json({ error: "Зөвхөн админ эсвэл агуулахын ажилтан импорт хийнэ" });
    return;
  }
  const parsedInput = ImportMealCountsBody.safeParse(req.body);
  if (!parsedInput.success) {
    res.status(400).json({ error: parsedInput.error.message });
    return;
  }
  const { dateFrom, dateTo } = parsedInput.data;
  if (!isValidDateRange(dateFrom, dateTo)) {
    res.status(400).json({ error: "Date range must contain valid calendar dates and cover at most 366 calendar days" });
    return;
  }

  const rawUrl = process.env.READER_MEAL_EXPORT_URL;
  const token = process.env.READER_MEAL_READ_TOKEN;
  const url = rawUrl ? readerUrl(rawUrl) : null;
  if (!url || !token) {
    res.status(503).json({ error: "Reader meal import is not configured" });
    return;
  }
  url.searchParams.set("dateFrom", dateFrom);
  url.searchParams.set("dateTo", dateTo);

  let upstreamPayload: unknown;
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      res.status(502).json({ error: "Reader meal import request failed" });
      return;
    }
    upstreamPayload = await response.json();
  } catch {
    res.status(502).json({ error: "Reader meal import request failed or timed out" });
    return;
  }

  const readerRecords = parseReaderRecords(upstreamPayload);
  if (!readerRecords) {
    res.status(502).json({ error: "Reader returned an invalid meal-count payload" });
    return;
  }

  const normalizedRecords = readerRecords.map((record) => ({
    ...record,
    mealType: cleanMealType(record.mealType),
  }));
  const uniqueKeys = new Set<string>();
  for (const record of normalizedRecords) {
    if (!record.mealType || !isValidCalendarDate(record.date)
      || record.date < dateFrom || record.date > dateTo) {
      res.status(502).json({ error: "Reader returned an invalid meal-count payload" });
      return;
    }
    const normalizedMealType = record.mealType.toLocaleLowerCase("mn-MN");
    const key = `${record.date}\u0000${normalizedMealType}`;
    if (uniqueKeys.has(key)) {
      res.status(502).json({ error: "Reader returned an invalid meal-count payload" });
      return;
    }
    uniqueKeys.add(key);
  }

  const updatedAt = new Date();
  try {
    if (normalizedRecords.length) {
      await db.insert(mealCountsTable).values(normalizedRecords.map((record) => ({
        date: record.date,
        mealType: record.mealType,
        normalizedMealType: record.mealType.toLocaleLowerCase("mn-MN"),
        count: record.count,
        syncedAt: updatedAt,
      }))).onConflictDoUpdate({
        target: [mealCountsTable.date, mealCountsTable.normalizedMealType],
        set: {
          mealType: sql`excluded.meal_type`,
          count: sql`excluded.count`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
    }
    res.json(ImportMealCountsResponse.parse({
      received: normalizedRecords.length,
      updatedAt,
    }));
  } catch (error) {
    next(error);
  }
});

readerMealCountsStaffRouter.get("/meal-counts", async (req, res, next): Promise<void> => {
  const parsed = ListMealCountsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { dateFrom, dateTo } = parsed.data;
  if (!isValidDateRange(dateFrom, dateTo)) {
    res.status(400).json({ error: "Date range must contain valid calendar dates and cover at most 366 calendar days" });
    return;
  }

  try {
    const rows = await db.select({
      date: mealCountsTable.date,
      mealType: mealCountsTable.mealType,
      count: mealCountsTable.count,
      syncedAt: mealCountsTable.syncedAt,
    }).from(mealCountsTable)
      .where(and(gte(mealCountsTable.date, dateFrom), lte(mealCountsTable.date, dateTo)))
      .orderBy(desc(mealCountsTable.date), asc(mealCountsTable.mealType));
    res.json(ListMealCountsResponse.parse(rows));
  } catch (error) {
    next(error);
  }
});