import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { and, eq } from "drizzle-orm";
import {
  attendanceDeviceEnrollmentsTable,
  attendanceDevicesTable,
  attendanceTable,
  db,
  employeesTable,
  officeAttendanceNetworkTable,
  officeAttendancePunchesTable,
  usersTable,
} from "@workspace/db";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import { deviceSigningText, enrollmentSigningText, officeCalendarDate } from "../lib/office-attendance-security.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import attendanceRouter from "./attendance.js";
import officeAttendanceRouter from "./office-attendance.js";

describe("office Wi-Fi attendance API", () => {
  let server: Server;
  let baseUrl: string;
  let cookie: string;
  let userId: number;
  let employeeId: number;
  let deviceId: number;
  let priorNetwork: typeof officeAttendanceNetworkTable.$inferSelect | undefined;
  const simulatedOfficeIp = "8.8.8.71";
  const oldEnvironment = {
    VERCEL: process.env["VERCEL"],
    NODE_ENV: process.env["NODE_ENV"],
    SESSION_SECRET: process.env["SESSION_SECRET"],
  };

  before(async () => {
    process.env.SESSION_SECRET = "office-attendance-test-only";
    process.env.VERCEL = "1";
    process.env.NODE_ENV = "production";
    [priorNetwork] = await db.select().from(officeAttendanceNetworkTable)
      .where(eq(officeAttendanceNetworkTable.id, 1));
    const suffix = `${process.pid}-${randomUUID()}`;
    const [user] = await db.insert(usersTable).values({
      username: `office-attendance-${suffix}`,
      normalizedUsername: `office-attendance-${suffix}`,
      role: "admin",
      passwordHash: "unused-in-test",
    }).returning({
      id: usersTable.id,
      username: usersTable.username,
      role: usersTable.role,
      tokenVersion: usersTable.tokenVersion,
    });
    userId = user.id;
    cookie = `${hrCookie.name}=${createStaffSession(user)}`;
    const [employee] = await db.insert(employeesTable).values({
      name: `Оффисын тест ${suffix}`,
      role: "test",
      phone: "",
      salaryType: "monthly",
      employeeType: "office",
      baseSalary: 0,
      socialInsuranceSalary: 0,
      payrollTaxExempt: false,
      fullSalaryRegardlessAttendance: false,
      payFrequency: "twice",
      monthlyExpectedWorkDays: 0,
      status: "active",
    }).returning({ id: employeesTable.id });
    employeeId = employee.id;

    const app = express();
    app.use(express.json());
    app.use("/api", officeAttendanceRouter);
    app.use("/api", requireStaffAuth, attendanceRouter);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (employeeId) {
      await db.delete(officeAttendancePunchesTable).where(eq(officeAttendancePunchesTable.employeeId, employeeId));
      await db.delete(attendanceTable).where(eq(attendanceTable.employeeId, employeeId));
      await db.delete(attendanceDevicesTable).where(eq(attendanceDevicesTable.employeeId, employeeId));
      await db.delete(attendanceDeviceEnrollmentsTable).where(eq(attendanceDeviceEnrollmentsTable.employeeId, employeeId));
      await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
    }
    if (priorNetwork) {
      await db.update(officeAttendanceNetworkTable).set({
        officeIp: priorNetwork.officeIp,
        updatedBy: priorNetwork.updatedBy,
        updatedAt: priorNetwork.updatedAt,
      }).where(eq(officeAttendanceNetworkTable.id, 1));
    } else {
      await db.delete(officeAttendanceNetworkTable).where(eq(officeAttendanceNetworkTable.id, 1));
    }
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    if (oldEnvironment.VERCEL === undefined) delete process.env["VERCEL"];
    else process.env.VERCEL = oldEnvironment.VERCEL;
    if (oldEnvironment.NODE_ENV === undefined) delete process.env["NODE_ENV"];
    else process.env.NODE_ENV = oldEnvironment.NODE_ENV;
    if (oldEnvironment.SESSION_SECRET === undefined) delete process.env["SESSION_SECRET"];
    else process.env.SESSION_SECRET = oldEnvironment.SESSION_SECRET;
  });

  async function request(path: string, init: RequestInit = {}, officeIp = simulatedOfficeIp) {
    return fetch(`${baseUrl}/api${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(officeIp ? { "x-forwarded-for": officeIp } : {}),
        ...(init.headers ?? {}),
      },
    });
  }

  function signedDeviceRequest(
    privateKey: KeyObject,
    action: "status" | "check-in" | "check-out",
    nonce = randomUUID(),
  ) {
    const timestamp = Date.now();
    const signature = sign("sha256", Buffer.from(deviceSigningText(action, deviceId, timestamp, nonce)), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    return { deviceId, timestamp, nonce, signature };
  }

  it("enrolls only from the simulated Vercel office edge and prevents replay/concurrent duplicate punches", async () => {
    const configured = await request("/attendance/office-network", {
      method: "PUT",
      headers: { cookie },
      body: JSON.stringify({ officeIp: simulatedOfficeIp }),
    });
    assert.equal(configured.status, 200);

    const enrollmentResponse = await request("/attendance/device-enrollments", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ employeeId }),
    });
    assert.equal(enrollmentResponse.status, 201);
    const enrollment = await enrollmentResponse.json() as { token: string };
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const publicKey = pair.publicKey.export({ format: "jwk" });
    const timestamp = Date.now();
    const enrollmentNonce = randomUUID();
    const enrollmentSignature = sign("sha256", Buffer.from(enrollmentSigningText(
      enrollment.token,
      timestamp,
      enrollmentNonce,
    )), { key: pair.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
    const registrationBody = {
      token: enrollment.token,
      publicKey: { kty: publicKey.kty, crv: publicKey.crv, x: publicKey.x, y: publicKey.y },
      timestamp,
      nonce: enrollmentNonce,
      signature: enrollmentSignature,
      name: "Employee phone browser",
    };
    const outsideRegistration = await request("/attendance/device/register", {
      method: "POST",
      body: JSON.stringify(registrationBody),
    }, "8.8.8.72");
    assert.equal(outsideRegistration.status, 403);
    const malformedForwarded = await request("/attendance/device/register", {
      method: "POST",
      headers: { "x-forwarded-for": `${simulatedOfficeIp}, 10.0.0.1` },
      body: JSON.stringify(registrationBody),
    });
    assert.equal(malformedForwarded.status, 403);

    const registration = await request("/attendance/device/register", {
      method: "POST",
      body: JSON.stringify(registrationBody),
    });
    assert.equal(registration.status, 201);
    const registered = await registration.json() as { deviceId: number };
    deviceId = registered.deviceId;
    const tokenHash = (await db.select({ tokenHash: attendanceDeviceEnrollmentsTable.tokenHash })
      .from(attendanceDeviceEnrollmentsTable)
      .where(eq(attendanceDeviceEnrollmentsTable.employeeId, employeeId)))[0].tokenHash;
    assert.notEqual(tokenHash, enrollment.token);

    const replayedRegistration = await request("/attendance/device/register", {
      method: "POST",
      body: JSON.stringify(registrationBody),
    });
    assert.equal(replayedRegistration.status, 409);

    const untrustedStatus = await request("/attendance/device/status", {
      method: "POST",
      body: JSON.stringify({ ...signedDeviceRequest(pair.privateKey, "status") }),
    }, "");
    assert.equal(untrustedStatus.status, 403);

    const officeDate = officeCalendarDate(new Date());
    const raceCheckIn = {
      ...signedDeviceRequest(pair.privateKey, "check-in"),
      action: "check-in",
    };
    const [racingHrInsert, racingDeviceCheckIn] = await Promise.all([
      request("/attendance", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({
          employeeId,
          date: officeDate,
          clockIn: "09:00",
          clockOut: "17:00",
          status: "present",
        }),
      }),
      request("/attendance/device/punch", {
        method: "POST",
        body: JSON.stringify(raceCheckIn),
      }),
    ]);
    assert.ok([racingHrInsert.status, racingDeviceCheckIn.status].includes(409));
    assert.ok([racingHrInsert.status, racingDeviceCheckIn.status].includes(201)
      || [racingHrInsert.status, racingDeviceCheckIn.status].includes(200));
    if (racingHrInsert.status === 201) {
      await db.delete(attendanceTable).where(and(
        eq(attendanceTable.employeeId, employeeId),
        eq(attendanceTable.date, officeDate),
      ));
    }

    const pendingBeforeCancel = await request("/attendance/office-pending", {
      headers: { cookie },
    });
    assert.equal(pendingBeforeCancel.status, 200);
    const pendingRows = await pendingBeforeCancel.json() as { id: number; employeeId: number }[];
    assert.equal(pendingRows.filter((row) => row.employeeId === employeeId).length,
      racingDeviceCheckIn.status === 200 ? 1 : 0);
    if (racingDeviceCheckIn.status !== 200) {
      const recoveryCheckIn = {
        ...signedDeviceRequest(pair.privateKey, "check-in"),
        action: "check-in",
      };
      const recovered = await request("/attendance/device/punch", {
        method: "POST",
        body: JSON.stringify(recoveryCheckIn),
      });
      assert.equal(recovered.status, 200);
    }
    const pendingList = await request("/attendance/office-pending", { headers: { cookie } });
    const activePunches = await pendingList.json() as { id: number; employeeId: number }[];
    const employeePunches = activePunches.filter((row) => row.employeeId === employeeId);
    assert.equal(employeePunches.length, 1);

    const manualWhilePending = await request("/attendance", {
      method: "PUT",
      headers: { cookie },
      body: JSON.stringify({ employeeId, date: officeDate, status: "present" }),
    });
    assert.equal(manualWhilePending.status, 409);

    const cancelledResponse = await request(`/attendance/office-pending/${employeePunches[0].id}/cancel`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ reason: "Employee forgot to check out" }),
    });
    assert.equal(cancelledResponse.status, 200);
    const cancellation = await cancelledResponse.json() as { id: number; cancelledBy: number; reason: string };
    assert.equal(cancellation.id, employeePunches[0].id);
    assert.equal(cancellation.cancelledBy, userId);
    assert.equal(cancellation.reason, "Employee forgot to check out");
    const remainingPending = await request("/attendance/office-pending", { headers: { cookie } });
    const remainingRows = await remainingPending.json() as { employeeId: number }[];
    assert.equal(remainingRows.some((row) => row.employeeId === employeeId), false);
    const statusAfterCancelBody = signedDeviceRequest(pair.privateKey, "status");
    const statusAfterCancel = await request("/attendance/device/status", {
      method: "POST",
      body: JSON.stringify(statusAfterCancelBody),
    });
    assert.equal(statusAfterCancel.status, 200);
    assert.equal((await statusAfterCancel.json() as { state: string }).state, "not-checked-in");

    const checkInBodies = [0, 1].map(() => ({
      ...signedDeviceRequest(pair.privateKey, "check-in"),
      action: "check-in",
    }));
    const concurrentCheckIns = await Promise.all(checkInBodies.map((body) => request("/attendance/device/punch", {
      method: "POST",
      body: JSON.stringify(body),
    })));
    assert.deepEqual(concurrentCheckIns.map((response) => response.status).sort(), [200, 409]);
    const successfulCheckIn = concurrentCheckIns.find((response) => response.status === 200)!;
    const successfulBody = await successfulCheckIn.json() as { state: string };
    assert.equal(successfulBody.state, "checked-in");
    const successfulRequestIndex = concurrentCheckIns.findIndex((response) => response.status === 200);
    const duplicateReplay = await request("/attendance/device/punch", {
      method: "POST",
      body: JSON.stringify(checkInBodies[successfulRequestIndex]),
    });
    assert.equal(duplicateReplay.status, 401);

    const checkoutBody = { ...signedDeviceRequest(pair.privateKey, "check-out"), action: "check-out" };
    const checkout = await request("/attendance/device/punch", {
      method: "POST",
      body: JSON.stringify(checkoutBody),
    });
    assert.equal(checkout.status, 200);
    const checkedOut = await checkout.json() as { state: string; attendanceId: number; officeDate: string };
    assert.equal(checkedOut.state, "checked-out");
    assert.ok(checkedOut.attendanceId);
    const [attendance] = await db.select().from(attendanceTable)
      .where(and(
        eq(attendanceTable.employeeId, employeeId),
        eq(attendanceTable.date, checkedOut.officeDate),
      ));
    assert.equal(attendance.status, "present");
    assert.ok(attendance.hours >= 0);

    const linkedDelete = await request(`/attendance?employeeId=${employeeId}&date=${checkedOut.officeDate}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(linkedDelete.status, 409);

    const ordinaryManualDate = "2099-01-02";
    await db.insert(attendanceTable).values({
      employeeId,
      date: ordinaryManualDate,
      clockIn: "09:00",
      clockOut: "17:00",
      hours: 8,
      status: "present",
    });
    const ordinaryDelete = await request(`/attendance?employeeId=${employeeId}&date=${ordinaryManualDate}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(ordinaryDelete.status, 204);
  });
});