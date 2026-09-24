import { Router, type IRouter } from "express";
import { asc, eq, sql } from "drizzle-orm";
import {
  db,
  inventoryItemsTable,
  mealIngredientsTable,
  mealsTable,
  mealEditRequestsTable,
  usersTable,
} from "@workspace/db";
import { getStaffRole, getStaffSession } from "../lib/hr-session.js";
import {
  CreateMealBody,
  CreateMealIngredientBody,
  CreateMealIngredientParams,
  CreateMealIngredientResponse,
  CreateMealResponse,
  DeleteMealIngredientParams,
  DeleteMealIngredientResponse,
  DeleteMealParams,
  ListMealsResponse,
  UpdateMealBody,
  UpdateMealIngredientBody,
  UpdateMealIngredientParams,
  UpdateMealIngredientResponse,
  UpdateMealParams,
  UpdateMealResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const clean = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ");
const normalized = (value: string) => clean(value).toLocaleLowerCase("mn-MN");
const calorie = (quantity: number, caloriesPerUnit: number) => Math.round(quantity * caloriesPerUnit * 1000) / 1000;
const MealEditBody = (value: unknown) => {
  const body = value as { name?: unknown; category?: unknown };
  if (typeof body?.name !== "string" || typeof body?.category !== "string" || !body.name.trim() || !body.category.trim()) {
    throw new Error("INVALID_EDIT");
  }
  return { name: body.name, category: body.category };
};
const editRequestView = (row: typeof mealEditRequestsTable.$inferSelect, requesterName: string | null = null) => ({
  ...row,
  requesterName,
  requestedAt: row.requestedAt.toISOString(),
  decidedAt: row.decidedAt?.toISOString() ?? null,
});

type DbClient = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

async function mealView(client: DbClient, mealId: number) {
  const [meal] = await client.select().from(mealsTable).where(eq(mealsTable.id, mealId));
  if (!meal) return null;
  const ingredients = await client.select({
    id: mealIngredientsTable.id,
    inventoryItemId: mealIngredientsTable.inventoryItemId,
    inventoryItemName: inventoryItemsTable.name,
    quantity: mealIngredientsTable.quantity,
    unit: mealIngredientsTable.unit,
    caloriesPerUnit: mealIngredientsTable.caloriesPerUnit,
    totalCalories: mealIngredientsTable.totalCalories,
  }).from(mealIngredientsTable)
    .innerJoin(inventoryItemsTable, eq(mealIngredientsTable.inventoryItemId, inventoryItemsTable.id))
    .where(eq(mealIngredientsTable.mealId, mealId))
    .orderBy(asc(mealIngredientsTable.id));
  return {
    id: meal.id,
    name: meal.name,
    category: meal.category,
    type: meal.type,
    isActive: meal.isActive,
    totalCalories: Number(meal.totalCalories),
    ingredients: ingredients.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      caloriesPerUnit: Number(item.caloriesPerUnit),
      totalCalories: Number(item.totalCalories),
    })),
    createdAt: meal.createdAt.toISOString(),
    updatedAt: meal.updatedAt.toISOString(),
  };
}

async function recalculateMeal(client: DbClient, mealId: number) {
  const [sum] = await client.select({
    total: sql<number>`coalesce(sum(${mealIngredientsTable.totalCalories}), 0)`,
  }).from(mealIngredientsTable).where(eq(mealIngredientsTable.mealId, mealId));
  await client.update(mealsTable)
    .set({ totalCalories: Number(sum.total), updatedAt: new Date() })
    .where(eq(mealsTable.id, mealId));
}

async function resolveInventoryItem(client: DbClient, input: {
  inventoryItemId?: number | null;
  inventoryItemName: string;
  inventoryItemCategory: string;
  unit: string;
}) {
  const name = clean(input.inventoryItemName);
  const category = clean(input.inventoryItemCategory);
  const unit = clean(input.unit);
  if (!name || !category || !unit) throw new Error("INVALID_INGREDIENT");
  if (input.inventoryItemId) {
    const [item] = await client.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, input.inventoryItemId));
    if (!item) throw new Error("INVENTORY_NOT_FOUND");
    return item;
  }
  const normalizedName = normalized(name);
  const [existing] = await client.select().from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.normalizedName, normalizedName));
  if (existing) return existing;
  const [created] = await client.insert(inventoryItemsTable).values({
    materialType: "supply",
    name,
    normalizedName,
    category,
    unit,
    quantity: 0,
  }).returning();
  return created;
}

router.get("/meals", async (_req, res, next): Promise<void> => {
  try {
    const rows = await db.select({ id: mealsTable.id }).from(mealsTable)
      .orderBy(asc(mealsTable.category), asc(mealsTable.name));
    const meals = await Promise.all(rows.map((row) => mealView(db, row.id)));
    res.json(ListMealsResponse.parse(meals.filter(Boolean)));
  } catch (error) {
    next(error);
  }
});

router.post("/meals", async (req, res, next): Promise<void> => {
  try {
    const input = CreateMealBody.parse(req.body);
    const name = clean(input.name);
    const category = clean(input.category);
    if (!name || !category) {
      res.status(400).json({ error: "Хоолны нэр болон ангилал хоосон байж болохгүй" });
      return;
    }
    const [duplicate] = await db.select({ id: mealsTable.id }).from(mealsTable)
      .where(eq(mealsTable.normalizedName, normalized(name)));
    if (duplicate) {
      res.status(409).json({ error: "Ийм нэртэй хоол аль хэдийн байна" });
      return;
    }
    const [meal] = await db.insert(mealsTable).values({
      name,
      normalizedName: normalized(name),
      category,
      type: input.type,
      isActive: input.isActive,
      totalCalories: 0,
    }).returning();
    res.status(201).json(CreateMealResponse.parse(await mealView(db, meal.id)));
  } catch (error) {
    next(error);
  }
});

router.put("/meals/:id", async (req, res, next): Promise<void> => {
  try {
    const { id } = UpdateMealParams.parse(req.params);
    const input = UpdateMealBody.parse(req.body);
    const name = clean(input.name);
    const category = clean(input.category);
    if (!name || !category) {
      res.status(400).json({ error: "Хоолны нэр болон ангилал хоосон байж болохгүй" });
      return;
    }
    const [duplicate] = await db.select({ id: mealsTable.id }).from(mealsTable)
      .where(eq(mealsTable.normalizedName, normalized(name)));
    if (duplicate && duplicate.id !== id) {
      res.status(409).json({ error: "Ийм нэртэй хоол аль хэдийн байна" });
      return;
    }
    const [meal] = await db.update(mealsTable).set({
      name,
      normalizedName: normalized(name),
      category,
      type: input.type,
      isActive: input.isActive,
      updatedAt: new Date(),
    }).where(eq(mealsTable.id, id)).returning();
    if (!meal) {
      res.status(404).json({ error: "Хоол олдсонгүй" });
      return;
    }
    res.json(UpdateMealResponse.parse(await mealView(db, id)));
  } catch (error) {
    next(error);
  }
});

router.post("/meals/:id/edit-request", async (req, res, next): Promise<void> => {
  try {
    const role = await getStaffRole(req);
    if (role !== "technologist") { res.status(403).json({ error: "Зөвхөн технологич хүсэлт илгээнэ" }); return; }
    const session = await getStaffSession(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "ID буруу байна" }); return; }
    const input = MealEditBody(req.body);
    const name = clean(input.name), category = clean(input.category);
    const result = await db.transaction(async (tx) => {
      const [meal] = await tx.select().from(mealsTable).where(eq(mealsTable.id, id)).for("update");
      if (!meal) throw new Error("MEAL_NOT_FOUND");
      const [pending] = await tx.select({ id: mealEditRequestsTable.id }).from(mealEditRequestsTable)
        .where(sql`${mealEditRequestsTable.mealId} = ${id} and ${mealEditRequestsTable.status} = 'pending'`);
      if (pending) throw new Error("PENDING");
      const [collision] = await tx.select({ id: mealsTable.id }).from(mealsTable)
        .where(eq(mealsTable.normalizedName, normalized(name)));
      if (collision && collision.id !== id) throw new Error("COLLISION");
      return tx.insert(mealEditRequestsTable).values({
        mealId: id, requesterId: session!.id, previousName: meal.name, previousCategory: meal.category,
        proposedName: name, proposedCategory: category,
      }).returning();
    });
    res.status(201).json(editRequestView(result[0]));
  } catch (error) {
    if (error instanceof Error && error.message === "MEAL_NOT_FOUND") { res.status(404).json({ error: "Хоол олдсонгүй" }); return; }
    if (error instanceof Error && error.message === "INVALID_EDIT") { res.status(400).json({ error: "Нэр болон ангилал шаардлагатай" }); return; }
    if (error instanceof Error && error.message === "PENDING") { res.status(409).json({ error: "Энэ хоолны өөрчлөлтийн хүсэлт хүлээгдэж байна" }); return; }
    if (error instanceof Error && error.message === "COLLISION") { res.status(409).json({ error: "Ийм нэртэй хоол аль хэдийн байна" }); return; }
    if ((error as { code?: string })?.code === "23505") { res.status(409).json({ error: "Энэ хоолны өөрчлөлтийн хүсэлт аль хэдийн байна" }); return; }
    next(error);
  }
});

router.get("/meal-edit-requests", async (req, res, next): Promise<void> => {
  try {
    if (await getStaffRole(req) !== "admin") { res.status(403).json({ error: "Зөвхөн админ хүсэлт харна" }); return; }
    const rows = await db.select({ request: mealEditRequestsTable, requesterName: usersTable.username })
      .from(mealEditRequestsTable).leftJoin(usersTable, eq(usersTable.id, mealEditRequestsTable.requesterId))
      .orderBy(sql`${mealEditRequestsTable.requestedAt} desc`);
    res.json(rows.map(({ request, requesterName }) => editRequestView(request, requesterName)));
  } catch (error) { next(error); }
});

router.post("/meal-edit-requests/:id/approve", async (req, res, next): Promise<void> => {
  try {
    const session = await getStaffSession(req);
    if (session?.role !== "admin") { res.status(403).json({ error: "Зөвхөн админ батална" }); return; }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "ID буруу байна" }); return; }
    const result = await db.transaction(async (tx) => {
      const [request] = await tx.select().from(mealEditRequestsTable).where(eq(mealEditRequestsTable.id, id)).for("update");
      if (!request) throw new Error("REQUEST_NOT_FOUND");
      if (request.status !== "pending") throw new Error("RESOLVED");
      const [meal] = await tx.select().from(mealsTable).where(eq(mealsTable.id, request.mealId)).for("update");
      if (!meal) throw new Error("MEAL_NOT_FOUND");
      if (meal.name !== request.previousName || meal.category !== request.previousCategory) throw new Error("STALE");
      const [collision] = await tx.select({ id: mealsTable.id }).from(mealsTable).where(eq(mealsTable.normalizedName, normalized(request.proposedName)));
      if (collision && collision.id !== meal.id) throw new Error("COLLISION");
      await tx.update(mealsTable).set({ name: request.proposedName, normalizedName: normalized(request.proposedName), category: request.proposedCategory, updatedAt: new Date() }).where(eq(mealsTable.id, meal.id));
      return tx.update(mealEditRequestsTable).set({ status: "approved", approvedBy: session.id, decidedAt: new Date() }).where(eq(mealEditRequestsTable.id, id)).returning();
    });
    res.json(editRequestView(result[0]));
  } catch (error) {
    if (error instanceof Error && error.message === "REQUEST_NOT_FOUND") { res.status(404).json({ error: "Хүсэлт олдсонгүй" }); return; }
    if (error instanceof Error && error.message === "MEAL_NOT_FOUND") { res.status(404).json({ error: "Хоол олдсонгүй" }); return; }
    if (error instanceof Error && error.message === "RESOLVED") { res.status(409).json({ error: "Хүсэлт аль хэдийн шийдэгдсэн" }); return; }
    if (error instanceof Error && error.message === "COLLISION") { res.status(409).json({ error: "Ийм нэртэй хоол аль хэдийн байна" }); return; }
    if (error instanceof Error && error.message === "STALE") { res.status(409).json({ error: "Хоол өөрчлөгдсөн тул хүсэлт хуучирсан байна" }); return; }
    next(error);
  }
});

router.post("/meal-edit-requests/:id/reject", async (req, res, next): Promise<void> => {
  try {
    const session = await getStaffSession(req);
    if (session?.role !== "admin") { res.status(403).json({ error: "Зөвхөн админ татгалзана" }); return; }
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId < 1) { res.status(400).json({ error: "ID буруу байна" }); return; }
    const [updated] = await db.update(mealEditRequestsTable).set({ status: "rejected", approvedBy: session.id, decidedAt: new Date() })
      .where(sql`${mealEditRequestsTable.id} = ${requestId} and ${mealEditRequestsTable.status} = 'pending'`).returning();
    if (!updated) { res.status(409).json({ error: "Хүлээгдэж буй хүсэлт олдсонгүй" }); return; }
    res.json(editRequestView(updated));
  } catch (error) { next(error); }
});

router.delete("/meals/:id", async (req, res, next): Promise<void> => {
  try {
    const { id } = DeleteMealParams.parse(req.params);
    const [meal] = await db.delete(mealsTable).where(eq(mealsTable.id, id)).returning({ id: mealsTable.id });
    if (!meal) {
      res.status(404).json({ error: "Хоол олдсонгүй" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    const databaseCode = (error as { code?: string; cause?: { code?: string } }).code
      ?? (error as { cause?: { code?: string } }).cause?.code;
    if (databaseCode === "23503") {
      res.status(409).json({ error: "Энэ хоол хуваарьт ашиглагдаж байгаа тул эхлээд хуваарийн бичлэгийг устгана уу" });
      return;
    }
    next(error);
  }
});

router.post("/meals/:mealId/ingredients", async (req, res, next): Promise<void> => {
  try {
    const { mealId } = CreateMealIngredientParams.parse(req.params);
    const input = CreateMealIngredientBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [meal] = await tx.select({ id: mealsTable.id }).from(mealsTable).where(eq(mealsTable.id, mealId));
      if (!meal) throw new Error("MEAL_NOT_FOUND");
      const item = await resolveInventoryItem(tx, input);
      await tx.insert(mealIngredientsTable).values({
        mealId,
        inventoryItemId: item.id,
        quantity: input.quantity,
        unit: clean(input.unit),
        caloriesPerUnit: input.caloriesPerUnit,
        totalCalories: calorie(input.quantity, input.caloriesPerUnit),
      });
      await recalculateMeal(tx, mealId);
      return mealView(tx, mealId);
    });
    res.status(201).json(CreateMealIngredientResponse.parse(result));
  } catch (error) {
    if (error instanceof Error && error.message === "MEAL_NOT_FOUND") {
      res.status(404).json({ error: "Хоол олдсонгүй" });
      return;
    }
    if (error instanceof Error && ["INVALID_INGREDIENT", "INVENTORY_NOT_FOUND"].includes(error.message)) {
      res.status(400).json({ error: "Орц эсвэл бараа материалын мэдээлэл буруу байна" });
      return;
    }
    next(error);
  }
});

router.put("/meals/:mealId/ingredients/:ingredientId", async (req, res, next): Promise<void> => {
  try {
    const { mealId, ingredientId } = UpdateMealIngredientParams.parse(req.params);
    const input = UpdateMealIngredientBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const item = await resolveInventoryItem(tx, input);
      const [ingredient] = await tx.update(mealIngredientsTable).set({
        inventoryItemId: item.id,
        quantity: input.quantity,
        unit: clean(input.unit),
        caloriesPerUnit: input.caloriesPerUnit,
        totalCalories: calorie(input.quantity, input.caloriesPerUnit),
        updatedAt: new Date(),
      }).where(sql`${mealIngredientsTable.id} = ${ingredientId} and ${mealIngredientsTable.mealId} = ${mealId}`)
        .returning({ id: mealIngredientsTable.id });
      if (!ingredient) throw new Error("INGREDIENT_NOT_FOUND");
      await recalculateMeal(tx, mealId);
      return mealView(tx, mealId);
    });
    res.json(UpdateMealIngredientResponse.parse(result));
  } catch (error) {
    if (error instanceof Error && error.message === "INGREDIENT_NOT_FOUND") {
      res.status(404).json({ error: "Орц олдсонгүй" });
      return;
    }
    if (error instanceof Error && ["INVALID_INGREDIENT", "INVENTORY_NOT_FOUND"].includes(error.message)) {
      res.status(400).json({ error: "Орц эсвэл бараа материалын мэдээлэл буруу байна" });
      return;
    }
    next(error);
  }
});

router.delete("/meals/:mealId/ingredients/:ingredientId", async (req, res, next): Promise<void> => {
  try {
    const { mealId, ingredientId } = DeleteMealIngredientParams.parse(req.params);
    const result = await db.transaction(async (tx) => {
      const [ingredient] = await tx.delete(mealIngredientsTable)
        .where(sql`${mealIngredientsTable.id} = ${ingredientId} and ${mealIngredientsTable.mealId} = ${mealId}`)
        .returning({ id: mealIngredientsTable.id });
      if (!ingredient) throw new Error("INGREDIENT_NOT_FOUND");
      await recalculateMeal(tx, mealId);
      return mealView(tx, mealId);
    });
    res.json(DeleteMealIngredientResponse.parse(result));
  } catch (error) {
    if (error instanceof Error && error.message === "INGREDIENT_NOT_FOUND") {
      res.status(404).json({ error: "Орц олдсонгүй" });
      return;
    }
    next(error);
  }
});

export default router;