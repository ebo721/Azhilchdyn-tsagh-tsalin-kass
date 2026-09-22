import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  inventoryItemsTable,
  mealIngredientsTable,
  mealsTable,
  usersTable,
} from "@workspace/db";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import mealsRouter from "./meals.js";

describe("meals and ingredients", () => {
  let server: Server;
  let baseUrl: string;
  let cookie: string;
  let userId: number;
  const mealIds: number[] = [];
  const inventoryIds: number[] = [];

  before(async () => {
    process.env.SESSION_SECRET = "meals-test-secret";
    const suffix = `${process.pid}-${randomUUID()}`;
    const [user] = await db.insert(usersTable).values({
      username: `meals-${suffix}`,
      normalizedUsername: `meals-${suffix}`,
      role: "admin",
      passwordHash: "not-used",
    }).returning({
      id: usersTable.id,
      username: usersTable.username,
      role: usersTable.role,
      tokenVersion: usersTable.tokenVersion,
    });
    userId = user.id;
    cookie = `${hrCookie.name}=${createStaffSession(user)}`;
    const app = express();
    app.use(express.json());
    app.use("/api", requireStaffAuth, mealsRouter);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    if (mealIds.length) await db.delete(mealsTable).where(inArray(mealsTable.id, mealIds));
    if (inventoryIds.length) await db.delete(inventoryItemsTable).where(inArray(inventoryItemsTable.id, inventoryIds));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  async function request(path: string, init: RequestInit = {}) {
    return fetch(`${baseUrl}/api${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json", ...init.headers },
    });
  }

  it("recalculates persisted calories after ingredient create, update, and delete", async () => {
    const suffix = randomUUID();
    const created = await request("/meals", {
      method: "POST",
      body: JSON.stringify({ name: `Тест хоол ${suffix}`, category: "Үндсэн", type: "set", isActive: true }),
    });
    assert.equal(created.status, 201);
    const meal = await created.json() as { id: number; totalCalories: number; ingredients: unknown[] };
    mealIds.push(meal.id);
    assert.equal(meal.totalCalories, 0);
    assert.deepEqual(meal.ingredients, []);

    const ingredientCreated = await request(`/meals/${meal.id}/ingredients`, {
      method: "POST",
      body: JSON.stringify({
        inventoryItemId: null,
        inventoryItemName: `Будаа ${suffix}`,
        inventoryItemCategory: "Хүнс",
        quantity: 150,
        unit: "гр",
        caloriesPerUnit: 1.3,
      }),
    });
    assert.equal(ingredientCreated.status, 201);
    const withIngredient = await ingredientCreated.json() as {
      totalCalories: number;
      ingredients: { id: number; inventoryItemId: number; totalCalories: number }[];
    };
    inventoryIds.push(withIngredient.ingredients[0].inventoryItemId);
    assert.equal(withIngredient.ingredients[0].totalCalories, 195);
    assert.equal(withIngredient.totalCalories, 195);

    const ingredientId = withIngredient.ingredients[0].id;
    const updated = await request(`/meals/${meal.id}/ingredients/${ingredientId}`, {
      method: "PUT",
      body: JSON.stringify({
        inventoryItemId: withIngredient.ingredients[0].inventoryItemId,
        inventoryItemName: `Будаа ${suffix}`,
        inventoryItemCategory: "Хүнс",
        quantity: 200,
        unit: "гр",
        caloriesPerUnit: 1.3,
      }),
    });
    assert.equal(updated.status, 200);
    const updatedMeal = await updated.json() as { totalCalories: number };
    assert.equal(updatedMeal.totalCalories, 260);

    const removed = await request(`/meals/${meal.id}/ingredients/${ingredientId}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const emptyMeal = await removed.json() as { totalCalories: number; ingredients: unknown[] };
    assert.equal(emptyMeal.totalCalories, 0);
    assert.deepEqual(emptyMeal.ingredients, []);

    const [persisted] = await db.select().from(mealsTable).where(eq(mealsTable.id, meal.id));
    const lines = await db.select().from(mealIngredientsTable).where(eq(mealIngredientsTable.mealId, meal.id));
    assert.equal(Number(persisted.totalCalories), 0);
    assert.equal(lines.length, 0);

    const updatedMealResponse = await request(`/meals/${meal.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: `Зассан хоол ${suffix}`, category: "Сет", type: "single", isActive: false }),
    });
    assert.equal(updatedMealResponse.status, 200);
    const updatedMealInfo = await updatedMealResponse.json() as { name: string; type: string; isActive: boolean };
    assert.equal(updatedMealInfo.name, `Зассан хоол ${suffix}`);
    assert.equal(updatedMealInfo.type, "single");
    assert.equal(updatedMealInfo.isActive, false);

    const deletedMealResponse = await request(`/meals/${meal.id}`, { method: "DELETE" });
    assert.equal(deletedMealResponse.status, 204);
    const [deletedMeal] = await db.select().from(mealsTable).where(eq(mealsTable.id, meal.id));
    assert.equal(deletedMeal, undefined);
  });
});