import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  inventoryItemsTable,
  inventoryMaterialRequestItemsTable,
  inventoryMaterialRequestsTable,
  mealScheduleEntriesTable,
  usersTable,
} from "@workspace/db";
import { getStaffRole, getStaffSession } from "../lib/hr-session.js";
import { isValidCalendarDate } from "../lib/route-shared.js";
import { ListMaterialRequestCatalogResponse } from "@workspace/api-zod";

const router: IRouter = Router();
const datePattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const statuses = ["pending", "approved", "rejected", "fulfilled"] as const;
type RequestStatus = typeof statuses[number];
const maxQuantity = 99_999_999_999.999;

router.get("/inventory/material-requests/catalog", async (_req, res): Promise<void> => {
  const items = await db.select({
    id: inventoryItemsTable.id,
    name: inventoryItemsTable.name,
    category: inventoryItemsTable.category,
    unit: inventoryItemsTable.unit,
  }).from(inventoryItemsTable).orderBy(inventoryItemsTable.category, inventoryItemsTable.name);
  res.json(ListMaterialRequestCatalogResponse.parse(items));
});

async function expandedRequest(id: number) {
  const [request] = await db.select({
    id: inventoryMaterialRequestsTable.id,
    requestedDate: inventoryMaterialRequestsTable.requestedDate,
    requesterId: inventoryMaterialRequestsTable.requesterId,
    requesterName: usersTable.username,
    mealScheduleEntryId: inventoryMaterialRequestsTable.mealScheduleEntryId,
    note: inventoryMaterialRequestsTable.note,
    status: inventoryMaterialRequestsTable.status,
    createdAt: inventoryMaterialRequestsTable.createdAt,
    updatedAt: inventoryMaterialRequestsTable.updatedAt,
  }).from(inventoryMaterialRequestsTable)
    .innerJoin(usersTable, eq(usersTable.id, inventoryMaterialRequestsTable.requesterId))
    .where(eq(inventoryMaterialRequestsTable.id, id));
  if (!request) return undefined;
  const lines = await db.select({
    id: inventoryMaterialRequestItemsTable.id,
    inventoryItemId: inventoryMaterialRequestItemsTable.inventoryItemId,
    itemName: inventoryMaterialRequestItemsTable.itemName,
    unit: inventoryMaterialRequestItemsTable.unit,
    quantity: inventoryMaterialRequestItemsTable.quantity,
  }).from(inventoryMaterialRequestItemsTable)
    .where(eq(inventoryMaterialRequestItemsTable.requestId, id));
  return { ...request, status: request.status as RequestStatus, lines };
}

router.get("/inventory/material-requests", async (_req, res): Promise<void> => {
  const requests = await db.select({
    id: inventoryMaterialRequestsTable.id,
    requestedDate: inventoryMaterialRequestsTable.requestedDate,
    requesterId: inventoryMaterialRequestsTable.requesterId,
    requesterName: usersTable.username,
    mealScheduleEntryId: inventoryMaterialRequestsTable.mealScheduleEntryId,
    note: inventoryMaterialRequestsTable.note,
    status: inventoryMaterialRequestsTable.status,
    createdAt: inventoryMaterialRequestsTable.createdAt,
    updatedAt: inventoryMaterialRequestsTable.updatedAt,
  }).from(inventoryMaterialRequestsTable)
    .innerJoin(usersTable, eq(usersTable.id, inventoryMaterialRequestsTable.requesterId))
    .orderBy(desc(inventoryMaterialRequestsTable.createdAt));
  const ids = requests.map((request) => request.id);
  const lines = ids.length ? await db.select().from(inventoryMaterialRequestItemsTable).where(inArray(inventoryMaterialRequestItemsTable.requestId, ids)) : [];
  res.json(requests.map((request) => ({
    ...request,
    status: request.status as RequestStatus,
    lines: lines.filter((line) => line.requestId === request.id).map(({ requestId: _requestId, ...line }) => line),
  })));
});

router.post("/inventory/material-requests", async (req, res): Promise<void> => {
  const role = await getStaffRole(req);
  if (role !== "admin" && role !== "warehouse" && role !== "technologist") {
    res.status(403).json({ error: "Материалын хүсэлт үүсгэх эрхгүй" });
    return;
  }
  const session = await getStaffSession(req);
  const body = req.body as { requestedDate?: unknown; mealScheduleEntryId?: unknown; note?: unknown; lines?: unknown };
  if (!session || typeof body.requestedDate !== "string" || !datePattern.test(body.requestedDate)
    || !isValidCalendarDate(body.requestedDate)
    || !Array.isArray(body.lines) || body.lines.length === 0
    || (body.note !== undefined && body.note !== null && typeof body.note !== "string")
    || (body.mealScheduleEntryId !== undefined && body.mealScheduleEntryId !== null
      && (!Number.isInteger(body.mealScheduleEntryId) || Number(body.mealScheduleEntryId) < 1))) {
    res.status(400).json({ error: "Хүсэлтийн мэдээлэл буруу байна" });
    return;
  }
  const inputLines = body.lines as Array<{ inventoryItemId?: unknown; quantity?: unknown }>;
  const itemIds = inputLines.map((line) => line.inventoryItemId);
  const validQuantity = (value: unknown): value is number => typeof value === "number"
    && Number.isFinite(value) && value > 0 && value <= maxQuantity
    && Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-7;
  if (inputLines.some((line) => !Number.isInteger(line.inventoryItemId) || !validQuantity(line.quantity))
    || new Set(itemIds).size !== itemIds.length) {
    res.status(400).json({ error: "Материалын мөрүүд буруу эсвэл давхардсан байна" });
    return;
  }
  const inventoryItemIds = itemIds as number[];
  const items = await db.select({
    id: inventoryItemsTable.id,
    name: inventoryItemsTable.name,
    unit: inventoryItemsTable.unit,
  }).from(inventoryItemsTable).where(inArray(inventoryItemsTable.id, inventoryItemIds));
  if (items.length !== inventoryItemIds.length) {
    res.status(400).json({ error: "Сонгосон материал олдсонгүй" });
    return;
  }
  if (body.mealScheduleEntryId !== undefined && body.mealScheduleEntryId !== null) {
    const [entry] = await db.select({ id: mealScheduleEntriesTable.id, date: mealScheduleEntriesTable.date })
      .from(mealScheduleEntriesTable).where(eq(mealScheduleEntriesTable.id, body.mealScheduleEntryId as number));
    if (!entry || entry.date !== body.requestedDate) {
      res.status(400).json({ error: "Хоолны хуваарийн холбоос олдсонгүй" });
      return;
    }
  }
  const created = await db.transaction(async (tx) => {
    const [request] = await tx.insert(inventoryMaterialRequestsTable).values({
      requestedDate: body.requestedDate as string,
      requesterId: session.id,
      mealScheduleEntryId: (body.mealScheduleEntryId ?? null) as number | null,
      note: (body.note ?? null) as string | null,
    }).returning({ id: inventoryMaterialRequestsTable.id });
    await tx.insert(inventoryMaterialRequestItemsTable).values(inputLines.map((line) => {
      const item = items.find((candidate) => candidate.id === line.inventoryItemId);
      return {
        requestId: request.id,
        inventoryItemId: item!.id,
        itemName: item!.name,
        unit: item!.unit,
        quantity: line.quantity as number,
      };
    }));
    return request;
  });
  const response = await expandedRequest(created.id);
  res.status(201).json(response);
});

router.patch("/inventory/material-requests/:id/status", async (req, res): Promise<void> => {
  const role = await getStaffRole(req);
  if (role !== "admin" && role !== "warehouse") {
    res.status(403).json({ error: "Хүсэлтийн төлөв өөрчлөх эрхгүй" });
    return;
  }
  const id = Number(req.params.id);
  const status = (req.body as { status?: unknown }).status;
  if (!Number.isInteger(id) || !statuses.includes(status as RequestStatus)) {
    res.status(400).json({ error: "Төлөвийн мэдээлэл буруу байна" });
    return;
  }
  const [request] = await db.select({ id: inventoryMaterialRequestsTable.id, status: inventoryMaterialRequestsTable.status })
    .from(inventoryMaterialRequestsTable).where(eq(inventoryMaterialRequestsTable.id, id));
  if (!request) {
    res.status(404).json({ error: "Материалын хүсэлт олдсонгүй" });
    return;
  }
  const allowed = request.status === "pending" ? ["approved", "rejected"] : request.status === "approved" ? ["fulfilled", "rejected"] : [];
  if (!allowed.includes(status as string)) {
    res.status(409).json({ error: "Хүсэлтийн төлөвийн шилжилт буруу байна" });
    return;
  }
  const [updated] = await db.update(inventoryMaterialRequestsTable)
    .set({ status: status as string })
    .where(and(eq(inventoryMaterialRequestsTable.id, id), eq(inventoryMaterialRequestsTable.status, request.status)))
    .returning({ id: inventoryMaterialRequestsTable.id });
  if (!updated) {
    res.status(409).json({ error: "Хүсэлтийн төлөв өөрчлөгдсөн байна" });
    return;
  }
  res.json(await expandedRequest(id));
});

export default router;