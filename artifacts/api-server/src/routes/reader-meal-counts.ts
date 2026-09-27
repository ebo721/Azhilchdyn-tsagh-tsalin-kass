import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, desc, gte, lte, sql } from "drizzle-orm";
import { db, mealCountsTable } from "@workspace/db";
import {
  ListMealCountsQueryParams,
  ListMealCountsResponse,
  PushReaderMealCountsBody,
  PushReaderMealCountsResponse,
} from "@workspace/api-zod";
import { isValidCalendarDate } from "../lib/route-shared.js";

export const readerMealCountsPushRouter: IRouter = Router();
export const readerMealCountsStaffRouter: IRouter = Router();

function cleanMealType(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function dateOrdinal(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function equalTokens(actual: string, expected: string) {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

readerMealCountsPushRouter.post("/reader/meal-counts", async (req, res, next): Promise<void> => {
  const expectedToken = process.env.READER_MEAL_PUSH_TOKEN;
  if (!expectedToken) {
    res.status(503).json({ error: "Reader push authentication is not configured" });
    return;
  }

  const authorization = req.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match || !equalTokens(match[1], expectedToken)) {
    res.status(401).json({ error: "Invalid reader token" });
    return;
  }

  const parsed = PushReaderMealCountsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const normalizedRecords = parsed.data.records.map((record) => ({
    ...record,
    mealType: cleanMealType(record.mealType),
  }));
  const uniqueKeys = new Set<string>();
  for (const record of normalizedRecords) {
    if (!isValidCalendarDate(record.date) || !record.mealType) {
      res.status(400).json({ error: "Invalid calendar date or meal type" });
      return;
    }
    const key = `${record.date}\u0000${record.mealType.toLocaleLowerCase("mn-MN")}`;
    if (uniqueKeys.has(key)) {
      res.status(400).json({ error: "Duplicate date and meal type in request" });
      return;
    }
    uniqueKeys.add(key);
  }

  const updatedAt = new Date();
  try {
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
    res.json(PushReaderMealCountsResponse.parse({
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
  if (!isValidCalendarDate(dateFrom) || !isValidCalendarDate(dateTo)) {
    res.status(400).json({ error: "Invalid calendar date" });
    return;
  }
  const daySpan = dateOrdinal(dateTo) - dateOrdinal(dateFrom);
  if (daySpan < 0 || daySpan >= 366) {
    res.status(400).json({ error: "Date range must cover at most 366 calendar days" });
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