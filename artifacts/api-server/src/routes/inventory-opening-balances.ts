import { Router } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, inventoryItemsTable, inventoryOpeningBalancesTable } from "@workspace/db";
import {
  CreateInventoryOpeningBalanceBody, CreateInventoryOpeningBalanceResponse,
  ListInventoryOpeningBalancesResponse, UpdateInventoryOpeningBalanceBody,
  UpdateInventoryOpeningBalanceParams, UpdateInventoryOpeningBalanceResponse,
  DeleteInventoryOpeningBalanceParams,
} from "@workspace/api-zod";
import { isValidCalendarDate, money } from "../lib/date-utils.js";
import { stockQuantity } from "../lib/inventory-lot-plan.js";
import type { Tx } from "../lib/route-shared.js";

const router = Router();
class OpeningBalanceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function cleanInput(body: unknown, update = false) {
  const input = (update ? UpdateInventoryOpeningBalanceBody : CreateInventoryOpeningBalanceBody).parse(body);
  const cleaned = { ...input, name: input.name.normalize("NFKC").trim(), category: input.category.trim(), unit: input.unit.trim() };
  if (!isValidCalendarDate(input.date)) throw new OpeningBalanceError(400, "Хуанлийн огноо буруу байна");
  if (!cleaned.name || !cleaned.category || !cleaned.unit) throw new OpeningBalanceError(400, "Барааны нэр, ангилал, нэгжийг бөглөнө үү");
  if (money(input.quantity * input.unitPrice) > 999999999999.99) throw new OpeningBalanceError(400, "Нийт өртөг зөвшөөрөгдөх хэмжээнээс хэтэрсэн");
  return cleaned;
}

async function openingResponse(tx: Tx | typeof db, id: number) {
  const [row] = await tx.select({ balance: inventoryOpeningBalancesTable, item: inventoryItemsTable })
    .from(inventoryOpeningBalancesTable)
    .innerJoin(inventoryItemsTable, eq(inventoryOpeningBalancesTable.inventoryItemId, inventoryItemsTable.id))
    .where(eq(inventoryOpeningBalancesTable.id, id));
  if (!row) throw new OpeningBalanceError(404, "Эхний үлдэгдлийн бүртгэл олдсонгүй");
  return formatOpening(row);
}

function formatOpening({ balance, item }: {
  balance: typeof inventoryOpeningBalancesTable.$inferSelect;
  item: typeof inventoryItemsTable.$inferSelect;
}) {
  return {
    ...balance, materialType: item.materialType, name: item.name, category: item.category, unit: item.unit,
    totalAmount: money(balance.quantity * balance.unitPrice),
    editable: balance.quantity === balance.remainingQuantity,
    createdAt: balance.createdAt.toISOString(),
  };
}

router.get("/inventory/opening-balances", async (_req, res, next) => {
  try {
    const rows = await db.select({ balance: inventoryOpeningBalancesTable, item: inventoryItemsTable })
      .from(inventoryOpeningBalancesTable)
      .innerJoin(inventoryItemsTable, eq(inventoryOpeningBalancesTable.inventoryItemId, inventoryItemsTable.id))
      .orderBy(desc(inventoryOpeningBalancesTable.date), desc(inventoryOpeningBalancesTable.id));
    res.json(ListInventoryOpeningBalancesResponse.parse(rows.map(formatOpening)));
  } catch (error) { next(error); }
});

router.post("/inventory/opening-balances", async (req, res, next) => {
  try {
    const input = cleanInput(req.body);
    const result = await db.transaction(async (tx) => {
      const normalizedName = input.name.toLocaleLowerCase("mn-MN");
      let [item] = await tx.select().from(inventoryItemsTable)
        .where(input.inventoryItemId ? eq(inventoryItemsTable.id, input.inventoryItemId) : eq(inventoryItemsTable.normalizedName, normalizedName))
        .for("update");
      if (!item && input.inventoryItemId) throw new OpeningBalanceError(404, "Бараа материал олдсонгүй");
      if (!item) {
        [item] = await tx.insert(inventoryItemsTable).values({
          name: input.name, normalizedName, category: input.category, unit: input.unit, materialType: input.materialType, quantity: 0,
        }).onConflictDoNothing().returning();
        if (!item) [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.normalizedName, normalizedName)).for("update");
      }
      if (item.unit !== input.unit || item.materialType !== input.materialType) {
        throw new OpeningBalanceError(409, "Бүртгэлтэй барааны нэгж болон төрөлтэй тохирохгүй байна");
      }
      if (Number(item.quantity) + input.quantity > 99999999999.999) throw new OpeningBalanceError(400, "Үлдэгдлийн тоо хэмжээ хэтэрсэн");
      const [balance] = await tx.insert(inventoryOpeningBalancesTable).values({
        inventoryItemId: item.id, date: input.date, quantity: input.quantity, remainingQuantity: input.quantity, unitPrice: input.unitPrice,
      }).returning();
      await tx.update(inventoryItemsTable).set({ quantity: sql`${inventoryItemsTable.quantity} + ${input.quantity}` })
        .where(eq(inventoryItemsTable.id, item.id));
      return openingResponse(tx, balance.id);
    });
    res.status(201).json(CreateInventoryOpeningBalanceResponse.parse(result));
  } catch (error) {
    if (error instanceof OpeningBalanceError) { res.status(error.status).json({ error: error.message }); return; }
    next(error);
  }
});

async function lockUnusedBalance(tx: Tx, id: number) {
  const [lookup] = await tx.select().from(inventoryOpeningBalancesTable).where(eq(inventoryOpeningBalancesTable.id, id));
  if (!lookup) throw new OpeningBalanceError(404, "Эхний үлдэгдлийн бүртгэл олдсонгүй");
  const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, lookup.inventoryItemId)).for("update");
  const [balance] = await tx.select().from(inventoryOpeningBalancesTable).where(eq(inventoryOpeningBalancesTable.id, id)).for("update");
  if (!balance) throw new OpeningBalanceError(404, "Эхний үлдэгдлийн бүртгэл олдсонгүй");
  if (balance.quantity !== balance.remainingQuantity) throw new OpeningBalanceError(409, "Зарлагдсан эхний үлдэгдлийг засах, устгах боломжгүй");
  return { item, balance };
}

router.put("/inventory/opening-balances/:id", async (req, res, next) => {
  try {
    const { id } = UpdateInventoryOpeningBalanceParams.parse(req.params);
    const input = cleanInput(req.body, true);
    const result = await db.transaction(async (tx) => {
      const { item, balance } = await lockUnusedBalance(tx, id);
      if ((input.inventoryItemId !== undefined && input.inventoryItemId !== item.id)
        || input.name !== item.name || input.unit !== item.unit || input.materialType !== item.materialType) {
        throw new OpeningBalanceError(409, "Засах үед барааг өөр бараагаар солих боломжгүй");
      }
      const quantity = stockQuantity(Number(item.quantity) - balance.quantity + input.quantity);
      if (quantity < 0 || quantity > 99999999999.999) throw new OpeningBalanceError(409, "Барааны үлдэгдлийн тоо хэмжээ буруу байна");
      await tx.update(inventoryItemsTable).set({ quantity }).where(eq(inventoryItemsTable.id, item.id));
      await tx.update(inventoryOpeningBalancesTable).set({
        date: input.date, quantity: input.quantity, remainingQuantity: input.quantity, unitPrice: input.unitPrice,
      }).where(eq(inventoryOpeningBalancesTable.id, id));
      return openingResponse(tx, id);
    });
    res.json(UpdateInventoryOpeningBalanceResponse.parse(result));
  } catch (error) {
    if (error instanceof OpeningBalanceError) { res.status(error.status).json({ error: error.message }); return; }
    next(error);
  }
});

router.delete("/inventory/opening-balances/:id", async (req, res, next) => {
  try {
    const { id } = DeleteInventoryOpeningBalanceParams.parse(req.params);
    await db.transaction(async (tx) => {
      const { item, balance } = await lockUnusedBalance(tx, id);
      if (Number(item.quantity) < balance.quantity) throw new OpeningBalanceError(409, "Барааны үлдэгдлийн тоо хэмжээ буруу байна");
      await tx.update(inventoryItemsTable).set({ quantity: sql`${inventoryItemsTable.quantity} - ${balance.quantity}` }).where(eq(inventoryItemsTable.id, item.id));
      await tx.delete(inventoryOpeningBalancesTable).where(eq(inventoryOpeningBalancesTable.id, id));
    });
    res.status(204).send();
  } catch (error) {
    if (error instanceof OpeningBalanceError) { res.status(error.status).json({ error: error.message }); return; }
    next(error);
  }
});

export default router;
