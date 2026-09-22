import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  mealScheduleEntriesTable,
  mealScheduleSlotsTable,
  mealsTable,
  usersTable,
} from "@workspace/db";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
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
  let userId: number;
  let mealId: number;
  const entryIds: number[] = [];

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
    app.use("/api", requireStaffAuth, mealScheduleRouter);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    if (entryIds.length) await db.delete(mealScheduleEntriesTable).where(inArray(mealScheduleEntriesTable.id, entryIds));
    await db.delete(mealsTable).where(eq(mealsTable.id, mealId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  async function request(path: string, init: RequestInit = {}) {
    return fetch(`${baseUrl}/api${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json", ...init.headers },
    });
  }

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