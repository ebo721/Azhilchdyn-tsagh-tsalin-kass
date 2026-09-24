import { Router, type IRouter, type Response } from "express";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import {
  db,
  mealsTable,
  mealScheduleEntriesTable,
  mealScheduleSlotsTable,
} from "@workspace/db";
import {
  CreateMealScheduleSlotBody,
  CreateMealScheduleSlotResponse,
  CreateMealScheduleEntryBody,
  CreateMealScheduleEntryResponse,
  DeleteMealScheduleSlotParams,
  DeleteMealScheduleEntryParams,
  ListMealScheduleQueryParams,
  ListMealScheduleResponse,
  ListMealScheduleSlotsResponse,
  MoveMealScheduleEntryBody,
  MoveMealScheduleEntryParams,
  MoveMealScheduleEntryResponse,
  UpdateMealScheduleSlotBody,
  UpdateMealScheduleSlotParams,
  UpdateMealScheduleSlotResponse,
  UpdateMealScheduleEntryBody,
  UpdateMealScheduleEntryParams,
  UpdateMealScheduleEntryResponse,
} from "@workspace/api-zod";
import { calendarDateOffset, isValidCalendarDate } from "../lib/route-shared.js";

const router: IRouter = Router();

type DbClient = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

function isMonday(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 1;
}

function validateEntryInput(input: {
  date: string;
  kind: "meal" | "break";
  mealId: number | null;
}) {
  if (!isValidCalendarDate(input.date)) return "INVALID_DATE";
  if ((input.kind === "meal" && input.mealId === null) || (input.kind === "break" && input.mealId !== null)) {
    return "INVALID_KIND";
  }
  return null;
}

function validateSlotInput(input: { name: string; startTime: string; endTime: string; sortOrder: number }) {
  if (!input.name.trim()) return "INVALID_NAME";
  if (input.startTime === input.endTime) return "INVALID_TIME_RANGE";
  return null;
}

async function slotView(client: DbClient, id: number) {
  const [slot] = await client.select({
    id: mealScheduleSlotsTable.id,
    name: mealScheduleSlotsTable.name,
    startTime: mealScheduleSlotsTable.startTime,
    endTime: mealScheduleSlotsTable.endTime,
    sortOrder: mealScheduleSlotsTable.sortOrder,
  }).from(mealScheduleSlotsTable)
    .where(and(eq(mealScheduleSlotsTable.id, id), eq(mealScheduleSlotsTable.isActive, true)));
  return slot ?? null;
}

async function ensureReferences(client: DbClient, slotId: number, mealId: number | null) {
  const [slot] = await client.select({ id: mealScheduleSlotsTable.id })
    .from(mealScheduleSlotsTable)
    .where(and(eq(mealScheduleSlotsTable.id, slotId), eq(mealScheduleSlotsTable.isActive, true)));
  if (!slot) throw new Error("SLOT_NOT_FOUND");
  if (mealId !== null) {
    const [meal] = await client.select({ id: mealsTable.id }).from(mealsTable).where(eq(mealsTable.id, mealId));
    if (!meal) throw new Error("MEAL_NOT_FOUND");
  }
}

async function entryView(client: DbClient, id: number) {
  const [entry] = await client.select({
    id: mealScheduleEntriesTable.id,
    date: mealScheduleEntriesTable.date,
    slotId: mealScheduleEntriesTable.slotId,
    slotName: mealScheduleSlotsTable.name,
    startTime: mealScheduleSlotsTable.startTime,
    endTime: mealScheduleSlotsTable.endTime,
    kind: mealScheduleEntriesTable.kind,
    mealId: mealScheduleEntriesTable.mealId,
    mealName: mealsTable.name,
    mealType: mealsTable.type,
    totalCalories: mealsTable.totalCalories,
    createdAt: mealScheduleEntriesTable.createdAt,
    updatedAt: mealScheduleEntriesTable.updatedAt,
  }).from(mealScheduleEntriesTable)
    .innerJoin(mealScheduleSlotsTable, eq(mealScheduleEntriesTable.slotId, mealScheduleSlotsTable.id))
    .leftJoin(mealsTable, eq(mealScheduleEntriesTable.mealId, mealsTable.id))
    .where(eq(mealScheduleEntriesTable.id, id));
  if (!entry) return null;
  return {
    ...entry,
    kind: entry.kind as "meal" | "break",
    mealType: entry.mealType as "single" | "set" | null,
    totalCalories: entry.totalCalories === null ? null : Number(entry.totalCalories),
  };
}

function sendKnownError(error: unknown, res: Response) {
  const databaseCode = (error as { code?: string; cause?: { code?: string } } | null)?.code
    ?? (error as { cause?: { code?: string } } | null)?.cause?.code;
  if (databaseCode === "23505") {
    res.status(409).json({ error: "Ижил нэр, дараалал эсвэл тухайн цагийн хуваарь давхардсан байна" });
    return true;
  }
  if (databaseCode === "23503") {
    res.status(409).json({ error: "Энэ хоолны цагт хуваарь бүртгэгдсэн тул устгах боломжгүй" });
    return true;
  }
  if (!(error instanceof Error)) return false;
  if (error.message === "ENTRY_NOT_FOUND") {
    res.status(404).json({ error: "Хуваарийн бичлэг олдсонгүй" });
    return true;
  }
  if (error.message === "SLOT_NOT_FOUND") {
    res.status(400).json({ error: "Хоолны цагийн мөр олдсонгүй" });
    return true;
  }
  if (error.message === "MEAL_NOT_FOUND") {
    res.status(400).json({ error: "Сонгосон хоол олдсонгүй" });
    return true;
  }
  return false;
}

router.get("/meal-schedule/slots", async (_req, res, next): Promise<void> => {
  try {
    const slots = await db.select({
      id: mealScheduleSlotsTable.id,
      name: mealScheduleSlotsTable.name,
      startTime: mealScheduleSlotsTable.startTime,
      endTime: mealScheduleSlotsTable.endTime,
      sortOrder: mealScheduleSlotsTable.sortOrder,
    }).from(mealScheduleSlotsTable)
      .where(eq(mealScheduleSlotsTable.isActive, true))
      .orderBy(asc(mealScheduleSlotsTable.sortOrder));
    res.json(ListMealScheduleSlotsResponse.parse(slots));
  } catch (error) {
    next(error);
  }
});

router.post("/meal-schedule/slots", async (req, res, next): Promise<void> => {
  try {
    const input = CreateMealScheduleSlotBody.parse(req.body);
    if (validateSlotInput(input)) {
      res.status(400).json({ error: "Нэр болон эхлэх, дуусах цагийн мэдээлэл буруу байна" });
      return;
    }
    const [created] = await db.insert(mealScheduleSlotsTable).values({
      ...input,
      name: input.name.trim(),
    }).returning({ id: mealScheduleSlotsTable.id });
    res.status(201).json(CreateMealScheduleSlotResponse.parse(await slotView(db, created.id)));
  } catch (error) {
    if (sendKnownError(error, res)) return;
    next(error);
  }
});

router.put("/meal-schedule/slots/:id", async (req, res, next): Promise<void> => {
  try {
    const { id } = UpdateMealScheduleSlotParams.parse(req.params);
    const input = UpdateMealScheduleSlotBody.parse(req.body);
    if (validateSlotInput(input)) {
      res.status(400).json({ error: "Нэр болон эхлэх, дуусах цагийн мэдээлэл буруу байна" });
      return;
    }
    const [updated] = await db.update(mealScheduleSlotsTable).set({
      ...input,
      name: input.name.trim(),
      updatedAt: new Date(),
    }).where(and(eq(mealScheduleSlotsTable.id, id), eq(mealScheduleSlotsTable.isActive, true)))
      .returning({ id: mealScheduleSlotsTable.id });
    if (!updated) {
      res.status(404).json({ error: "Хоолны цагийн мөр олдсонгүй" });
      return;
    }
    res.json(UpdateMealScheduleSlotResponse.parse(await slotView(db, id)));
  } catch (error) {
    if (sendKnownError(error, res)) return;
    next(error);
  }
});

router.delete("/meal-schedule/slots/:id", async (req, res, next): Promise<void> => {
  try {
    const { id } = DeleteMealScheduleSlotParams.parse(req.params);
    const [used] = await db.select({ id: mealScheduleEntriesTable.id })
      .from(mealScheduleEntriesTable)
      .where(eq(mealScheduleEntriesTable.slotId, id))
      .limit(1);
    if (used) {
      res.status(409).json({ error: "Энэ хоолны цагт хуваарь бүртгэгдсэн тул эхлээд хуваарийг устгана уу" });
      return;
    }
    const [deleted] = await db.delete(mealScheduleSlotsTable)
      .where(eq(mealScheduleSlotsTable.id, id))
      .returning({ id: mealScheduleSlotsTable.id });
    if (!deleted) {
      res.status(404).json({ error: "Хоолны цагийн мөр олдсонгүй" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    if (sendKnownError(error, res)) return;
    next(error);
  }
});

router.get("/meal-schedule", async (req, res, next): Promise<void> => {
  try {
    const { weekStart } = ListMealScheduleQueryParams.parse(req.query);
    if (!isValidCalendarDate(weekStart) || !isMonday(weekStart)) {
      res.status(400).json({ error: "7 хоногийн эхлэх огноо Даваа гараг байх ёстой" });
      return;
    }
    const weekEnd = calendarDateOffset(weekStart, 7).toISOString().slice(0, 10);
    const ids = await db.select({ id: mealScheduleEntriesTable.id })
      .from(mealScheduleEntriesTable)
      .where(and(gte(mealScheduleEntriesTable.date, weekStart), lt(mealScheduleEntriesTable.date, weekEnd)))
      .orderBy(asc(mealScheduleEntriesTable.date), asc(mealScheduleEntriesTable.slotId));
    const entries = await Promise.all(ids.map(({ id }) => entryView(db, id)));
    res.json(ListMealScheduleResponse.parse(entries.filter(Boolean)));
  } catch (error) {
    next(error);
  }
});

router.post("/meal-schedule", async (req, res, next): Promise<void> => {
  try {
    const input = CreateMealScheduleEntryBody.parse(req.body);
    if (validateEntryInput(input)) {
      res.status(400).json({ error: "Хуваарийн өдөр, төрөл эсвэл хоолны мэдээлэл буруу байна" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      await ensureReferences(tx, input.slotId, input.mealId);
      const [existing] = await tx.select({ id: mealScheduleEntriesTable.id })
        .from(mealScheduleEntriesTable)
        .where(and(eq(mealScheduleEntriesTable.date, input.date), eq(mealScheduleEntriesTable.slotId, input.slotId)));
      if (existing) throw new Error("CELL_OCCUPIED");
      const [created] = await tx.insert(mealScheduleEntriesTable).values(input).returning({ id: mealScheduleEntriesTable.id });
      return entryView(tx, created.id);
    });
    res.status(201).json(CreateMealScheduleEntryResponse.parse(result));
  } catch (error) {
    if (error instanceof Error && error.message === "CELL_OCCUPIED") {
      res.status(409).json({ error: "Энэ өдөр, цагт хуваарь бүртгэгдсэн байна" });
      return;
    }
    if (sendKnownError(error, res)) return;
    next(error);
  }
});

router.put("/meal-schedule/:id", async (req, res, next): Promise<void> => {
  try {
    const { id } = UpdateMealScheduleEntryParams.parse(req.params);
    const input = UpdateMealScheduleEntryBody.parse(req.body);
    if (validateEntryInput(input)) {
      res.status(400).json({ error: "Хуваарийн өдөр, төрөл эсвэл хоолны мэдээлэл буруу байна" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      await ensureReferences(tx, input.slotId, input.mealId);
      const [current] = await tx.select({ id: mealScheduleEntriesTable.id })
        .from(mealScheduleEntriesTable).where(eq(mealScheduleEntriesTable.id, id));
      if (!current) throw new Error("ENTRY_NOT_FOUND");
      const [occupied] = await tx.select({ id: mealScheduleEntriesTable.id })
        .from(mealScheduleEntriesTable)
        .where(and(eq(mealScheduleEntriesTable.date, input.date), eq(mealScheduleEntriesTable.slotId, input.slotId)));
      if (occupied && occupied.id !== id) throw new Error("CELL_OCCUPIED");
      await tx.update(mealScheduleEntriesTable).set({ ...input, updatedAt: new Date() })
        .where(eq(mealScheduleEntriesTable.id, id));
      return entryView(tx, id);
    });
    res.json(UpdateMealScheduleEntryResponse.parse(result));
  } catch (error) {
    if (error instanceof Error && error.message === "CELL_OCCUPIED") {
      res.status(409).json({ error: "Энэ өдөр, цагт хуваарь бүртгэгдсэн байна" });
      return;
    }
    if (sendKnownError(error, res)) return;
    next(error);
  }
});

router.delete("/meal-schedule/:id", async (req, res, next): Promise<void> => {
  try {
    const { id } = DeleteMealScheduleEntryParams.parse(req.params);
    const [deleted] = await db.delete(mealScheduleEntriesTable)
      .where(eq(mealScheduleEntriesTable.id, id))
      .returning({ id: mealScheduleEntriesTable.id });
    if (!deleted) {
      res.status(404).json({ error: "Хуваарийн бичлэг олдсонгүй" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post("/meal-schedule/:id/move", async (req, res, next): Promise<void> => {
  try {
    const { id } = MoveMealScheduleEntryParams.parse(req.params);
    const input = MoveMealScheduleEntryBody.parse(req.body);
    if (!isValidCalendarDate(input.date)) {
      res.status(400).json({ error: "Хуваарийн өдөр буруу байна" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(73042101)`);
      await ensureReferences(tx, input.slotId, null);
      const [source] = await tx.select().from(mealScheduleEntriesTable)
        .where(eq(mealScheduleEntriesTable.id, id))
        .for("update");
      if (!source) throw new Error("ENTRY_NOT_FOUND");
      if (source.date === input.date && source.slotId === input.slotId) {
        return [await entryView(tx, id)];
      }
      const [target] = await tx.select().from(mealScheduleEntriesTable)
        .where(and(eq(mealScheduleEntriesTable.date, input.date), eq(mealScheduleEntriesTable.slotId, input.slotId)))
        .for("update");
      if (target) {
        await tx.delete(mealScheduleEntriesTable).where(eq(mealScheduleEntriesTable.id, target.id));
      }
      await tx.update(mealScheduleEntriesTable)
        .set({ date: input.date, slotId: input.slotId, updatedAt: new Date() })
        .where(eq(mealScheduleEntriesTable.id, source.id));
      if (target) {
        await tx.insert(mealScheduleEntriesTable).values({
          id: target.id,
          date: source.date,
          slotId: source.slotId,
          kind: target.kind,
          mealId: target.mealId,
          createdAt: target.createdAt,
          updatedAt: new Date(),
        });
      }
      const moved = await entryView(tx, source.id);
      const replacement = target ? await entryView(tx, target.id) : null;
      return [moved, replacement].filter(Boolean);
    });
    res.json(MoveMealScheduleEntryResponse.parse(result));
  } catch (error) {
    if (sendKnownError(error, res)) return;
    next(error);
  }
});

export default router;