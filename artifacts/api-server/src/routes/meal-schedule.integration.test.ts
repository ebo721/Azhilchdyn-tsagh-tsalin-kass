import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  deletionRequestsTable,
  mealScheduleEntriesTable,
  mealScheduleSlotsTable,
  mealsTable,
  usersTable,
} from "@workspace/db";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import deletionRequestsRouter from "./deletion-requests.js";
import mealScheduleRouter from "./meal-schedule.js";

function nextMonday(offsetWeeks = 0) {
  const value = new Date(Date.UTC(2098, 0, 1));
  const days = (8 - value.getUTCDay()) % 7;
  value.setUTCDate(value.getUTCDate() + days + offsetWeeks * 7);
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe("weekly meal schedule", () => {
  let server: Server;
  let baseUrl: string;
  let cookie: string;
  let warehouseCookie: string;
  let userId: number;
  let warehouseUserId: number;
  let mealId: number;
  const entryIds: number[] = [];
  const slotIds: number[] = [];
  const deletionRequestIds: number[] = [];

  before(async () => {
    process.env.SESSION_SECRET = "meal-schedule-test-secret";
    const suffix = `${process.pid}-${randomUUID()}`;
    const [user] = await db.insert(usersTable).values({
      username: `meal-schedule-${suffix}`,
      normalizedUsername: `meal-schedule-${suffix}`,
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
    const [warehouseUser] = await db.insert(usersTable).values({
      username: `meal-schedule-warehouse-${suffix}`,
      normalizedUsername: `meal-schedule-warehouse-${suffix}`,
      role: "warehouse",
      passwordHash: "not-used",
    }).returning({
      id: usersTable.id,
      username: usersTable.username,
      role: usersTable.role,
      tokenVersion: usersTable.tokenVersion,
    });
    warehouseUserId = warehouseUser.id;
    warehouseCookie = `${hrCookie.name}=${createStaffSession(warehouseUser)}`;
    const [meal] = await db.insert(mealsTable).values({
      name: `Хуваарийн тест ${suffix}`,
      normalizedName: `хуваарийн тест ${suffix}`,
      category: "Тест",
      type: "single",
      isActive: true,
      totalCalories: 420,
    }).returning({ id: mealsTable.id });
    mealId = meal.id;
    const app = express();
    app.use(express.json());
    app.use("/api", requireStaffAuth, deletionRequestsRouter, mealScheduleRouter);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    if (deletionRequestIds.length) await db.delete(deletionRequestsTable).where(inArray(deletionRequestsTable.id, deletionRequestIds));
    if (entryIds.length) await db.delete(mealScheduleEntriesTable).where(inArray(mealScheduleEntriesTable.id, entryIds));
    if (slotIds.length) await db.delete(mealScheduleSlotsTable).where(inArray(mealScheduleSlotsTable.id, slotIds));
    await db.delete(mealsTable).where(eq(mealsTable.id, mealId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await db.delete(usersTable).where(eq(usersTable.id, warehouseUserId));
  });

  async function request(path: string, init: RequestInit = {}) {
    return requestAs(cookie, path, init);
  }

  async function requestAs(sessionCookie: string, path: string, init: RequestInit = {}) {
    return fetch(`${baseUrl}/api${path}`, {
      ...init,
      headers: { cookie: sessionCookie, "content-type": "application/json", ...init.headers },
    });
  }

  it("creates, validates, edits and deletes meal-time rows", async () => {
    const suffix = randomUUID();
    const sortOrder = 100_000 + Math.floor(Math.random() * 100_000);
    const createdResponse = await request("/meal-schedule/slots", {
      method: "POST",
      body: JSON.stringify({
        name: `Зууш ${suffix}`,
        startTime: "23:00",
        endTime: "02:00",
        sortOrder,
      }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { id: number; name: string; startTime: string; endTime: string; sortOrder: number };
    slotIds.push(created.id);
    assert.equal(created.startTime, "23:00");
    assert.equal(created.endTime, "02:00");
    assert.equal(created.sortOrder, sortOrder);

    const invalidRange = await request("/meal-schedule/slots", {
      method: "POST",
      body: JSON.stringify({
        name: `Буруу ${suffix}`,
        startTime: "16:00",
        endTime: "16:00",
        sortOrder: sortOrder + 1,
      }),
    });
    assert.equal(invalidRange.status, 400);

    const duplicateOrder = await request("/meal-schedule/slots", {
      method: "POST",
      body: JSON.stringify({
        name: `Давхардсан ${suffix}`,
        startTime: "16:00",
        endTime: "16:30",
        sortOrder,
      }),
    });
    assert.equal(duplicateOrder.status, 409);

    const updatedResponse = await request(`/meal-schedule/slots/${created.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: `Зууш зассан ${suffix}`,
        startTime: "15:30",
        endTime: "16:00",
        sortOrder: sortOrder + 2,
      }),
    });
    assert.equal(updatedResponse.status, 200);
    const updated = await updatedResponse.json() as { name: string; startTime: string; endTime: string };
    assert.equal(updated.name, `Зууш зассан ${suffix}`);
    assert.equal(updated.startTime, "15:30");
    assert.equal(updated.endTime, "16:00");

    const overnightResponse = await request(`/meal-schedule/slots/${created.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: `Зууш зассан ${suffix}`,
        startTime: "23:00",
        endTime: "02:00",
        sortOrder: sortOrder + 2,
      }),
    });
    assert.equal(overnightResponse.status, 200);
    const overnight = await overnightResponse.json() as { startTime: string; endTime: string };
    assert.equal(overnight.startTime, "23:00");
    assert.equal(overnight.endTime, "02:00");
    const listed = await request("/meal-schedule/slots");
    assert.equal(listed.status, 200);
    const savedSlots = await listed.json() as { id: number; startTime: string; endTime: string }[];
    assert.deepEqual(
      savedSlots.find((slot) => slot.id === created.id),
      { id: created.id, startTime: "23:00", endTime: "02:00", name: `Зууш зассан ${suffix}`, sortOrder: sortOrder + 2 },
    );

    const deleted = await request(`/meal-schedule/slots/${created.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 204);
    slotIds.splice(slotIds.indexOf(created.id), 1);
  });

  it("lets warehouse request slot deletion and admin approve it", async () => {
    const suffix = randomUUID();
    const createdResponse = await requestAs(warehouseCookie, "/meal-schedule/slots", {
      method: "POST",
      body: JSON.stringify({
        name: `Няравын устгал ${suffix}`,
        startTime: "16:00",
        endTime: "16:30",
        sortOrder: 300_000 + Math.floor(Math.random() * 100_000),
      }),
    });
    assert.equal(createdResponse.status, 201);
    const slot = await createdResponse.json() as { id: number };
    slotIds.push(slot.id);

    const queuedResponse = await requestAs(warehouseCookie, "/deletion-requests", {
      method: "POST",
      body: JSON.stringify({
        targetPath: `/meal-schedule/slots/${slot.id}`,
        label: "Тест хоолны цаг",
      }),
    });
    assert.equal(queuedResponse.status, 201);
    const queued = await queuedResponse.json() as { id: number; status: string };
    deletionRequestIds.push(queued.id);
    assert.equal(queued.status, "pending");

    const approvedResponse = await request(`/deletion-requests/${queued.id}/approve`, { method: "POST" });
    const approvedBody = await approvedResponse.text();
    assert.equal(approvedResponse.status, 200, approvedBody);
    const approved = JSON.parse(approvedBody) as { status: string };
    assert.equal(approved.status, "completed");
    slotIds.splice(slotIds.indexOf(slot.id), 1);

    const listedResponse = await request("/meal-schedule/slots");
    const listed = await listedResponse.json() as { id: number }[];
    assert.ok(!listed.some((candidate) => candidate.id === slot.id));
  });

  it("creates, edits, swaps and deletes meal and break cells", async () => {
    const slotsResponse = await request("/meal-schedule/slots");
    assert.equal(slotsResponse.status, 200);
    const slots = await slotsResponse.json() as { id: number; name: string }[];
    assert.ok(slots.length >= 2);

    const weekStart = nextMonday(10);
    const tuesday = addDays(weekStart, 1);
    const badWeek = await request(`/meal-schedule?weekStart=${tuesday}`);
    assert.equal(badWeek.status, 400);

    const mealResponse = await request("/meal-schedule", {
      method: "POST",
      body: JSON.stringify({ date: weekStart, slotId: slots[0].id, kind: "meal", mealId }),
    });
    assert.equal(mealResponse.status, 201);
    const mealEntry = await mealResponse.json() as { id: number; kind: string; mealName: string; totalCalories: number };
    entryIds.push(mealEntry.id);
    assert.equal(mealEntry.kind, "meal");
    assert.equal(mealEntry.totalCalories, 420);

    const usedSlotDelete = await request(`/meal-schedule/slots/${slots[0].id}`, { method: "DELETE" });
    assert.equal(usedSlotDelete.status, 409);

    const breakResponse = await request("/meal-schedule", {
      method: "POST",
      body: JSON.stringify({ date: tuesday, slotId: slots[1].id, kind: "break", mealId: null }),
    });
    assert.equal(breakResponse.status, 201);
    const breakEntry = await breakResponse.json() as { id: number; kind: string; mealId: null };
    entryIds.push(breakEntry.id);
    assert.equal(breakEntry.kind, "break");
    assert.equal(breakEntry.mealId, null);

    const duplicate = await request("/meal-schedule", {
      method: "POST",
      body: JSON.stringify({ date: weekStart, slotId: slots[0].id, kind: "break", mealId: null }),
    });
    assert.equal(duplicate.status, 409);

    const moved = await request(`/meal-schedule/${mealEntry.id}/move`, {
      method: "POST",
      body: JSON.stringify({ date: tuesday, slotId: slots[1].id }),
    });
    assert.equal(moved.status, 200);
    const swapped = await moved.json() as { id: number; date: string; slotId: number; kind: string }[];
    assert.equal(swapped.length, 2);
    assert.ok(swapped.some((entry) => entry.id === mealEntry.id && entry.date === tuesday && entry.kind === "meal"));
    const replacement = swapped.find((entry) => entry.kind === "break");
    assert.ok(replacement);
    entryIds.push(replacement.id);

    const updated = await request(`/meal-schedule/${mealEntry.id}`, {
      method: "PUT",
      body: JSON.stringify({ date: tuesday, slotId: slots[1].id, kind: "break", mealId: null }),
    });
    assert.equal(updated.status, 200);
    const updatedEntry = await updated.json() as { kind: string; mealId: null };
    assert.equal(updatedEntry.kind, "break");
    assert.equal(updatedEntry.mealId, null);

    const listResponse = await request(`/meal-schedule?weekStart=${weekStart}`);
    assert.equal(listResponse.status, 200);
    const listed = await listResponse.json() as { id: number }[];
    assert.equal(listed.length, 2);

    for (const id of listed.map((entry) => entry.id)) {
      const deleted = await request(`/meal-schedule/${id}`, { method: "DELETE" });
      assert.equal(deleted.status, 204);
    }
    const emptyResponse = await request(`/meal-schedule?weekStart=${weekStart}`);
    assert.deepEqual(await emptyResponse.json(), []);
  });
});