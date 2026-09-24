import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  deletionRequestsTable,
  mealEditRequestsTable,
  mealScheduleEntriesTable,
  mealScheduleSlotsTable,
  mealsTable,
  usersTable,
} from "@workspace/db";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import deletionRequestsRouter from "./deletion-requests.js";
import mealScheduleRouter from "./meal-schedule.js";
import mealsRouter from "./meals.js";

describe("technologist meal workflow", () => {
  let server: Server;
  let baseUrl: string;
  let technologistCookie: string;
  let adminCookie: string;
  let technologistId: number;
  let adminId: number;
  const mealIds: number[] = [];
  const slotIds: number[] = [];
  const entryIds: number[] = [];
  const editRequestIds: number[] = [];
  const deletionRequestIds: number[] = [];

  before(async () => {
    process.env.SESSION_SECRET = "technologist-meal-workflow-test-secret";
    const suffix = `${process.pid}-${randomUUID()}`;
    const [technologist] = await db.insert(usersTable).values({
      username: `meal-technologist-${suffix}`,
      normalizedUsername: `meal-technologist-${suffix}`,
      role: "technologist",
      passwordHash: "not-used",
    }).returning({ id: usersTable.id, username: usersTable.username, role: usersTable.role, tokenVersion: usersTable.tokenVersion });
    const [admin] = await db.insert(usersTable).values({
      username: `meal-admin-${suffix}`,
      normalizedUsername: `meal-admin-${suffix}`,
      role: "admin",
      passwordHash: "not-used",
    }).returning({ id: usersTable.id, username: usersTable.username, role: usersTable.role, tokenVersion: usersTable.tokenVersion });
    technologistId = technologist.id;
    adminId = admin.id;
    technologistCookie = `${hrCookie.name}=${createStaffSession(technologist)}`;
    adminCookie = `${hrCookie.name}=${createStaffSession(admin)}`;

    const [morning, afternoon] = await db.insert(mealScheduleSlotsTable).values([
      { name: `Өглөөний цай ${suffix}`, startTime: "08:00", endTime: "08:30", sortOrder: 910000, isActive: true },
      { name: `Өдрийн хоол ${suffix}`, startTime: "12:00", endTime: "12:30", sortOrder: 910001, isActive: true },
    ]).returning({ id: mealScheduleSlotsTable.id });
    slotIds.push(morning.id, afternoon.id);

    const app = express();
    app.use(express.json());
    app.use("/api", requireStaffAuth, deletionRequestsRouter, mealsRouter, mealScheduleRouter);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    if (deletionRequestIds.length) await db.delete(deletionRequestsTable).where(inArray(deletionRequestsTable.id, deletionRequestIds));
    if (editRequestIds.length) await db.delete(mealEditRequestsTable).where(inArray(mealEditRequestsTable.id, editRequestIds));
    if (entryIds.length) await db.delete(mealScheduleEntriesTable).where(inArray(mealScheduleEntriesTable.id, entryIds));
    if (mealIds.length) await db.delete(mealsTable).where(inArray(mealsTable.id, mealIds));
    if (slotIds.length) await db.delete(mealScheduleSlotsTable).where(inArray(mealScheduleSlotsTable.id, slotIds));
    await db.delete(usersTable).where(eq(usersTable.id, technologistId));
    await db.delete(usersTable).where(eq(usersTable.id, adminId));
  });

  async function requestAs(cookie: string, path: string, init: RequestInit = {}) {
    return fetch(`${baseUrl}/api${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json", ...init.headers },
    });
  }
  const tech = (path: string, init: RequestInit = {}) => requestAs(technologistCookie, path, init);
  const admin = (path: string, init: RequestInit = {}) => requestAs(adminCookie, path, init);

  async function createMeal(name = `Технологичийн хоол ${randomUUID()}`) {
    const response = await tech("/meals", {
      method: "POST",
      body: JSON.stringify({ name, category: "Үндсэн", type: "set", isActive: true }),
    });
    assert.equal(response.status, 201);
    const meal = await response.json() as { id: number };
    mealIds.push(meal.id);
    return meal.id;
  }

  it("allows technologists to read/create meals, edit ingredients, and create schedule entries", async () => {
    assert.equal((await tech("/meals")).status, 200);
    assert.equal((await tech("/meal-schedule/slots")).status, 200);
    const mealId = await createMeal();

    const ingredient = await tech(`/meals/${mealId}/ingredients`, {
      method: "POST",
      body: JSON.stringify({
        inventoryItemId: null, inventoryItemName: `Будаа ${randomUUID()}`, inventoryItemCategory: "Хүнс",
        quantity: 100, unit: "гр", caloriesPerUnit: 1.2,
      }),
    });
    assert.equal(ingredient.status, 201);
    const withIngredient = await ingredient.json() as { ingredients: { id: number; inventoryItemId: number }[] };
    const ingredientId = withIngredient.ingredients[0].id;
    const inventoryItemId = withIngredient.ingredients[0].inventoryItemId;
    assert.equal((await tech(`/meals/${mealId}/ingredients/${ingredientId}`, {
      method: "PUT",
      body: JSON.stringify({
        inventoryItemId, inventoryItemName: "Будаа", inventoryItemCategory: "Хүнс",
        quantity: 125, unit: "гр", caloriesPerUnit: 1.2,
      }),
    })).status, 200);
    assert.equal((await tech(`/meals/${mealId}/ingredients/${ingredientId}`, { method: "DELETE" })).status, 200);

    const entryResponse = await tech("/meal-schedule", {
      method: "POST",
      body: JSON.stringify({ date: "2099-01-04", slotId: slotIds[0], kind: "meal", mealId }),
    });
    assert.equal(entryResponse.status, 201);
    const entry = await entryResponse.json() as { id: number };
    entryIds.push(entry.id);
  });

  it("forbids direct meal edits/deletes and all schedule or slot writes", async () => {
    const mealId = await createMeal();
    const body = JSON.stringify({ name: "Шууд засвар", category: "Үндсэн", type: "single", isActive: true });
    assert.equal((await tech(`/meals/${mealId}`, { method: "PUT", body })).status, 403);
    assert.equal((await tech(`/meals/${mealId}`, { method: "DELETE" })).status, 403);
    assert.equal((await tech(`/meal-schedule/slots/${slotIds[0]}`, { method: "PUT", body: JSON.stringify({
      name: "Өөр", startTime: "09:00", endTime: "09:30", sortOrder: 910002,
    }) })).status, 403);
    assert.equal((await tech(`/meal-schedule/slots/${slotIds[0]}`, { method: "DELETE" })).status, 403);
    assert.equal((await tech("/meal-schedule/slots", { method: "POST", body: JSON.stringify({
      name: "Хориглосон", startTime: "10:00", endTime: "10:30", sortOrder: 910003,
    }) })).status, 403);
    const created = await admin("/meal-schedule", {
      method: "POST",
      body: JSON.stringify({ date: "2099-01-11", slotId: slotIds[0], kind: "meal", mealId }),
    });
    assert.equal(created.status, 201);
    const entry = await created.json() as { id: number };
    entryIds.push(entry.id);
    assert.equal((await tech(`/meal-schedule/${entry.id}`, { method: "PUT", body: JSON.stringify({
      date: "2099-01-11", slotId: slotIds[1], kind: "meal", mealId,
    }) })).status, 403);
    assert.equal((await tech(`/meal-schedule/${entry.id}`, { method: "DELETE" })).status, 403);
    assert.equal((await tech(`/meal-schedule/${entry.id}/move`, {
      method: "POST", body: JSON.stringify({ date: "2099-01-12", slotId: slotIds[1] }),
    })).status, 403);
  });

  it("keeps pending edit requests unchanged, applies only approved name/category, and rejects stale/colliding edits", async () => {
    const mealId = await createMeal();
    const proposedName = `Батлагдсан ${randomUUID()}`;
    const queuedResponse = await tech(`/meals/${mealId}/edit-request`, {
      method: "POST", body: JSON.stringify({ name: proposedName, category: "Шинэ ангилал" }),
    });
    assert.equal(queuedResponse.status, 201);
    const queued = await queuedResponse.json() as { id: number; status: string };
    editRequestIds.push(queued.id);
    assert.equal(queued.status, "pending");
    assert.equal((await tech(`/meals/${mealId}/edit-request`, {
      method: "POST", body: JSON.stringify({ name: "Дахин", category: "Дахин" }),
    })).status, 409);
    const before = await (await tech("/meals")).json() as { id: number; name: string; category: string; type: string; isActive: boolean }[];
    const unchanged = before.find((meal) => meal.id === mealId)!;
    assert.equal(unchanged.name.startsWith("Технологичийн хоол"), true);
    assert.equal(unchanged.type, "set");
    const approved = await admin(`/meal-edit-requests/${queued.id}/approve`, { method: "POST" });
    assert.equal(approved.status, 200);
    assert.equal((await admin(`/meal-edit-requests/${queued.id}/approve`, { method: "POST" })).status, 409);
    const afterApproval = (await (await tech("/meals")).json() as typeof before).find((meal) => meal.id === mealId)!;
    assert.equal(afterApproval.name, proposedName);
    assert.equal(afterApproval.category, "Шинэ ангилал");
    assert.equal(afterApproval.type, "set");
    assert.equal(afterApproval.isActive, true);

    const rejectedMealId = await createMeal();
    const rejectResponse = await tech(`/meals/${rejectedMealId}/edit-request`, {
      method: "POST", body: JSON.stringify({ name: `Татгалзсан ${randomUUID()}`, category: "Өөр" }),
    });
    const rejected = await rejectResponse.json() as { id: number };
    editRequestIds.push(rejected.id);
    assert.equal((await admin(`/meal-edit-requests/${rejected.id}/reject`, { method: "POST" })).status, 200);
    const rejectedView = (await (await tech("/meals")).json() as typeof before).find((meal) => meal.id === rejectedMealId)!;
    assert.equal(rejectedView.category, "Үндсэн");

    const staleMealId = await createMeal();
    const staleRequest = await tech(`/meals/${staleMealId}/edit-request`, {
      method: "POST", body: JSON.stringify({ name: `Хуучирсан ${randomUUID()}`, category: "Өөр" }),
    });
    const stale = await staleRequest.json() as { id: number };
    editRequestIds.push(stale.id);
    assert.equal((await admin(`/meals/${staleMealId}`, {
      method: "PUT", body: JSON.stringify({ name: `Админы засвар ${randomUUID()}`, category: "Үндсэн", type: "set", isActive: true }),
    })).status, 200);
    assert.equal((await admin(`/meal-edit-requests/${stale.id}/approve`, { method: "POST" })).status, 409);

    const collisionMealId = await createMeal(`Давхцах нэр ${randomUUID()}`);
    const collisionTargetId = await createMeal();
    const collisionRequest = await tech(`/meals/${collisionTargetId}/edit-request`, {
      method: "POST", body: JSON.stringify({ name: (await (await tech("/meals")).json() as typeof before).find((meal) => meal.id === collisionMealId)!.name, category: "Үндсэн" }),
    });
    assert.equal(collisionRequest.status, 409);
  });

  it("requires an admin-approved deletion request before a technologist meal can be deleted", async () => {
    const mealId = await createMeal();
    assert.equal((await tech(`/meals/${mealId}`, { method: "DELETE" })).status, 403);
    const queuedResponse = await tech("/deletion-requests", {
      method: "POST", body: JSON.stringify({ targetPath: `/meals/${mealId}`, label: "Тест хоол устгах" }),
    });
    assert.equal(queuedResponse.status, 201);
    const queued = await queuedResponse.json() as { id: number; status: string };
    deletionRequestIds.push(queued.id);
    assert.equal(queued.status, "pending");
    assert.equal((await tech(`/meals/${mealId}`, { method: "DELETE", headers: { "x-deletion-request-id": String(queued.id) } })).status, 403);
    const approved = await admin(`/deletion-requests/${queued.id}/approve`, { method: "POST" });
    assert.equal(approved.status, 200);
    assert.equal((await tech("/meals")).status, 200);
    const meals = await (await tech("/meals")).json() as { id: number }[];
    assert.equal(meals.some((meal) => meal.id === mealId), false);
    mealIds.splice(mealIds.indexOf(mealId), 1);
  });

  it("serializes concurrent meal deletion approvals", async () => {
    const mealId = await createMeal();
    const queuedResponse = await tech("/deletion-requests", {
      method: "POST", body: JSON.stringify({ targetPath: `/meals/${mealId}`, label: "Давхар баталгаажуулалт" }),
    });
    assert.equal(queuedResponse.status, 201);
    const queued = await queuedResponse.json() as { id: number };
    deletionRequestIds.push(queued.id);

    const responses = await Promise.all([
      admin(`/deletion-requests/${queued.id}/approve`, { method: "POST" }),
      admin(`/deletion-requests/${queued.id}/approve`, { method: "POST" }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal((await (await tech("/meals")).json() as { id: number }[]).some((meal) => meal.id === mealId), false);
    mealIds.splice(mealIds.indexOf(mealId), 1);
  });

  it("rolls back meal deletion and leaves the request pending when the meal is referenced", async () => {
    const mealId = await createMeal();
    const scheduled = await admin("/meal-schedule", {
      method: "POST",
      body: JSON.stringify({ date: "2099-02-01", slotId: slotIds[0], kind: "meal", mealId }),
    });
    assert.equal(scheduled.status, 201);
    const entry = await scheduled.json() as { id: number };
    entryIds.push(entry.id);
    const queuedResponse = await tech("/deletion-requests", {
      method: "POST", body: JSON.stringify({ targetPath: `/meals/${mealId}`, label: "Хуваарьтай хоол устгах" }),
    });
    assert.equal(queuedResponse.status, 201);
    const queued = await queuedResponse.json() as { id: number };
    deletionRequestIds.push(queued.id);

    const failed = await admin(`/deletion-requests/${queued.id}/approve`, { method: "POST" });
    assert.equal(failed.status, 409);
    const [request] = await db.select({ status: deletionRequestsTable.status })
      .from(deletionRequestsTable).where(eq(deletionRequestsTable.id, queued.id));
    assert.equal(request.status, "pending");
    assert.equal((await (await tech("/meals")).json() as { id: number }[]).some((meal) => meal.id === mealId), true);
  });
});