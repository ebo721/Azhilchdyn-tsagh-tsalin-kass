import { Router, type IRouter } from "express";
import { and, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { db, inventoryClosingBalancesTable, inventoryItemsTable, inventoryIssuesTable } from "@workspace/db";
import {
  ConfirmInventoryClosingIssueParams, ConfirmInventoryClosingIssueResponse,
  CreateInventoryClosingBalanceBody, CreateInventoryClosingBalanceResponse,
  UpdateInventoryClosingBalanceBody, UpdateInventoryClosingBalanceParams, UpdateInventoryClosingBalanceResponse,
  DeleteInventoryClosingBalanceParams, GetInventoryClosingQuoteQueryParams, GetInventoryClosingQuoteResponse,
  ListInventoryClosingBalancesResponse,
} from "@workspace/api-zod";
import { inventoryClosingQuote, inventoryClosingView, formatInventoryClosing, InventoryClosingError } from "../lib/inventory-closing.js";
import { inventoryCustodian, InventoryCustodianError } from "../lib/inventory-custodian.js";
import { applyInventoryFifoConsumption, planInventoryFifoConsumption } from "../lib/inventory-fifo.js";
import { isValidCalendarDate } from "../lib/route-shared.js";
import { getStaffSession } from "../lib/hr-session.js";
import { stockQuantity } from "../lib/inventory-lot-plan.js";
import { money } from "../lib/date-utils.js";

const router: IRouter = Router();
type Input = ReturnType<typeof CreateInventoryClosingBalanceBody.parse>;
function validate(input: Input) {
  if (!isValidCalendarDate(input.date)) throw new InventoryClosingError(400, "Хуанлийн огноо буруу байна");
}

/** Lock order is count, linked issue, then item, including approval. */
async function save(input: Input, id?: number) {
  validate(input);
  return db.transaction(async tx => {
    const [existing] = id === undefined ? [] : await tx.select().from(inventoryClosingBalancesTable)
      .where(eq(inventoryClosingBalancesTable.id, id)).for("update");
    if (id !== undefined && !existing) throw new InventoryClosingError(404, "Эцсийн үлдэгдлийн бүртгэл олдсонгүй");
    if (existing?.approvedAt) throw new InventoryClosingError(409, "Баталгаажсан зөрүүний эцсийн үлдэгдлийг засах боломжгүй");
    if (existing?.issueId) await tx.select().from(inventoryIssuesTable).where(eq(inventoryIssuesTable.id, existing.issueId)).for("update");
    const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, input.inventoryItemId)).for("update");
    if (!item) throw new InventoryClosingError(404, "Бараа материал олдсонгүй");
    const quote = await inventoryClosingQuote(tx, input.inventoryItemId, input.date);
    if (quote.unitPrice === null || quote.priceSource === "none") throw new InventoryClosingError(409, "Сонгосон огноо хүртэл худалдан авалт эсвэл үнэтэй эхний үлдэгдэл байхгүй. Үнэ тодорхойгүй тул хадгалах боломжгүй.");
    if (money(input.quantity * quote.unitPrice) > 999999999999.99) throw new InventoryClosingError(400, "Нийт дүн зөвшөөрөгдөх хэмжээнээс хэтэрсэн");
    const assignment = await inventoryCustodian(tx, undefined, existing, existing && existing.responsibleEmployeeId === input.responsibleEmployeeId ? undefined : input.responsibleEmployeeId);
    // The history-preserving helper can return the entire existing document.
    // Only copy assignment columns, never parent IDs/status into a linked issue.
    const responsible = {
      responsibleEmployeeId: assignment.responsibleEmployeeId,
      responsibleUserId: assignment.responsibleUserId,
      responsibleName: assignment.responsibleName,
    };
    if (!responsible.responsibleName) throw new InventoryClosingError(400, "Хариуцагч сонгоно уу");
    const shortage = stockQuantity(quote.bookQuantity - input.quantity);
    if (shortage > 0) {
      const [pending] = await tx.select({ id: inventoryClosingBalancesTable.id }).from(inventoryClosingBalancesTable)
        .where(and(eq(inventoryClosingBalancesTable.inventoryItemId, input.inventoryItemId),
          isNotNull(inventoryClosingBalancesTable.issueId), isNull(inventoryClosingBalancesTable.approvedAt),
          id === undefined ? undefined : ne(inventoryClosingBalancesTable.id, id))).limit(1);
      if (pending) throw new InventoryClosingError(409, "Энэ бараанд баталгаажаагүй дутагдал байна. Өмнөх бүртгэлийг засах эсвэл баталгаажуулна уу.");
    }
    const issueData = { ...responsible, inventoryItemId: item.id, date: input.date, quantity: shortage, purpose: `Эцсийн үлдэгдлийн дутагдал (${input.date})` };
    let issueId: number | null = null;
    if (shortage > 0) {
      const [issue] = existing?.issueId
        ? await tx.update(inventoryIssuesTable).set(issueData).where(eq(inventoryIssuesTable.id, existing.issueId)).returning()
        : await tx.insert(inventoryIssuesTable).values(issueData).returning();
      issueId = issue.id;
    }
    const values = {
      ...responsible, responsibleName: responsible.responsibleName, inventoryItemId: item.id, date: input.date,
      quantity: input.quantity, bookQuantity: quote.bookQuantity, unitPrice: quote.unitPrice,
      priceSource: quote.priceSource, issueId,
    };
    const [count] = existing
      ? await tx.update(inventoryClosingBalancesTable).set(values).where(eq(inventoryClosingBalancesTable.id, existing.id)).returning()
      : await tx.insert(inventoryClosingBalancesTable).values(values).returning();
    if (existing?.issueId && issueId === null) await tx.delete(inventoryIssuesTable).where(eq(inventoryIssuesTable.id, existing.issueId));
    return inventoryClosingView(tx, count.id);
  });
}

router.get("/inventory/closing-balances/quote", async (req, res, next) => {
  try {
    const input = GetInventoryClosingQuoteQueryParams.parse(req.query);
    if (!isValidCalendarDate(input.date)) throw new InventoryClosingError(400, "Хуанлийн огноо буруу байна");
    res.json(GetInventoryClosingQuoteResponse.parse(await inventoryClosingQuote(db, input.inventoryItemId, input.date)));
  } catch (error) { next(error); }
});
router.get("/inventory/closing-balances", async (_req, res, next) => {
  try {
    const rows = await db.select({ count: inventoryClosingBalancesTable, item: inventoryItemsTable }).from(inventoryClosingBalancesTable)
      .innerJoin(inventoryItemsTable, eq(inventoryItemsTable.id, inventoryClosingBalancesTable.inventoryItemId))
      .orderBy(desc(inventoryClosingBalancesTable.date), desc(inventoryClosingBalancesTable.id));
    res.json(ListInventoryClosingBalancesResponse.parse(rows.map(formatInventoryClosing)));
  } catch (error) { next(error); }
});
router.post("/inventory/closing-balances", async (req, res, next) => {
  try { res.status(201).json(CreateInventoryClosingBalanceResponse.parse(await save(CreateInventoryClosingBalanceBody.parse(req.body)))); }
  catch (error) { next(error); }
});
router.put("/inventory/closing-balances/:id", async (req, res, next) => {
  try {
    const { id } = UpdateInventoryClosingBalanceParams.parse(req.params);
    res.json(UpdateInventoryClosingBalanceResponse.parse(await save(UpdateInventoryClosingBalanceBody.parse(req.body), id)));
  } catch (error) { next(error); }
});
router.delete("/inventory/closing-balances/:id", async (req, res, next) => {
  try {
    const { id } = DeleteInventoryClosingBalanceParams.parse(req.params);
    await db.transaction(async tx => {
      const [count] = await tx.select().from(inventoryClosingBalancesTable).where(eq(inventoryClosingBalancesTable.id, id)).for("update");
      if (!count) throw new InventoryClosingError(404, "Эцсийн үлдэгдлийн бүртгэл олдсонгүй");
      if (count.approvedAt) throw new InventoryClosingError(409, "Баталгаажсан эцсийн үлдэгдлийг устгах боломжгүй");
      if (count.issueId) await tx.select().from(inventoryIssuesTable).where(eq(inventoryIssuesTable.id, count.issueId)).for("update");
      await tx.delete(inventoryClosingBalancesTable).where(eq(inventoryClosingBalancesTable.id, id));
      if (count.issueId) await tx.delete(inventoryIssuesTable).where(eq(inventoryIssuesTable.id, count.issueId));
    });
    res.status(204).send();
  } catch (error) { next(error); }
});
router.post("/inventory/issues/:id/confirm", async (req, res, next) => {
  try {
    const { id } = ConfirmInventoryClosingIssueParams.parse(req.params);
    const session = await getStaffSession(req);
    if (!session || !["admin", "warehouse"].includes(session.role)) throw new InventoryClosingError(403, "Зөрүү баталгаажуулах эрхгүй");
    const result = await db.transaction(async tx => {
      const [count] = await tx.select().from(inventoryClosingBalancesTable).where(eq(inventoryClosingBalancesTable.issueId, id)).for("update");
      if (!count) throw new InventoryClosingError(404, "Эцсийн үлдэгдлийн зөрүү олдсонгүй");
      if (count.approvedAt) return inventoryClosingView(tx, count.id);
      const [issue] = await tx.select().from(inventoryIssuesTable).where(eq(inventoryIssuesTable.id, id)).for("update");
      await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, count.inventoryItemId)).for("update");
      const current = await inventoryClosingQuote(tx, count.inventoryItemId, count.date);
      if (current.bookQuantity !== count.bookQuantity) throw new InventoryClosingError(409, "Бүртгэлийн үлдэгдэл өөрчлөгдсөн байна. Эцсийн үлдэгдлийг дахин нээж хадгалаад баталгаажуулна уу.");
      if (!issue || stockQuantity(count.bookQuantity - count.quantity) !== Number(issue.quantity)) throw new InventoryClosingError(409, "Зөрүүний бүртгэл тохирохгүй байна");
      const plan = await planInventoryFifoConsumption(tx, count.inventoryItemId, Number(issue.quantity), count.date);
      if (!plan) throw new InventoryClosingError(409, "Сонгосон огноо хүртэлх барааны одоогийн үлдэгдэл дутагдлыг хасахад хүрэлцэхгүй байна");
      await applyInventoryFifoConsumption(tx, issue.id, count.inventoryItemId, plan);
      await tx.update(inventoryClosingBalancesTable).set({ approvedAt: new Date(), approvedByUserId: session.id })
        .where(eq(inventoryClosingBalancesTable.id, count.id));
      return inventoryClosingView(tx, count.id);
    });
    res.json(ConfirmInventoryClosingIssueResponse.parse(result));
  } catch (error) { next(error); }
});
router.use((error: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  if (error instanceof InventoryClosingError) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof InventoryCustodianError) { res.status(400).json({ error: error.message }); return; }
  if (error instanceof Error && error.name === "ZodError") { res.status(400).json({ error: "Огноо, тоо хэмжээ, хариуцагчийн мэдээллийг зөв оруулна уу" }); return; }
  const pg = error as { code?: string; cause?: { code?: string } };
  if (pg?.code === "23505" || pg?.cause?.code === "23505") { res.status(409).json({ error: "Энэ барааны тухайн өдрийн эцсийн үлдэгдэл аль хэдийн бүртгэгдсэн байна" }); return; }
  next(error);
});
export default router;
