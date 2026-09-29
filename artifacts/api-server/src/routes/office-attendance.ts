import { Router, type IRouter } from "express";
import { randomBytes, createHash } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  CreateAttendanceDeviceEnrollmentBody,
  CreateAttendanceDeviceEnrollmentResponse,
  CancelOfficeAttendancePendingPunchBody,
  CancelOfficeAttendancePendingPunchParams,
  CancelOfficeAttendancePendingPunchResponse,
  GetAttendanceDeviceStatusBody,
  GetAttendanceDeviceStatusResponse,
  GetOfficeAttendanceNetworkResponse,
  ListAttendanceDeviceEnrollmentsResponse,
  ListAttendanceDevicesResponse,
  ListOfficeAttendancePendingPunchesResponse,
  PunchAttendanceDeviceBody,
  PunchAttendanceDeviceResponse,
  RegisterAttendanceDeviceBody,
  RegisterAttendanceDeviceResponse,
  RevokeAttendanceDeviceParams,
  SetOfficeAttendanceNetworkBody,
  SetOfficeAttendanceNetworkResponse,
} from "@workspace/api-zod";
import {
  attendanceDeviceEnrollmentsTable,
  attendanceDevicesTable,
  attendanceTable,
  db,
  employeesTable,
  officeAttendanceNetworkTable,
  officeAttendanceNoncesTable,
  officeAttendancePunchesTable,
} from "@workspace/db";
import { getStaffSession } from "../lib/hr-session.js";
import {
  deviceSigningText,
  enrollmentSigningText,
  isFreshTimestamp,
  isOfficeNetworkRequest,
  normalizeConfiguredIp,
  nonceDigest,
  officeCalendarDate,
  officeClockTime,
  verifyP256Signature,
} from "../lib/office-attendance-security.js";

const router: IRouter = Router();
const ENROLLMENT_LIFETIME_MS = 10 * 60 * 1000;
const INVALID_NETWORK_ERROR = "Оффисын баталгаатай сүлжээнээс хүсэлт илгээнэ үү";
const INVALID_DEVICE_ERROR = "Төхөөрөмжийн бүртгэл хүчингүй эсвэл идэвхгүй байна";

function sendInvalid(res: Parameters<Parameters<IRouter["post"]>[1]>[1], status: number, message: string): void {
  res.status(status).json({ error: message });
}

async function requireAttendanceStaff(req: Parameters<Parameters<IRouter["get"]>[1]>[0], res: Parameters<Parameters<IRouter["get"]>[1]>[1]): Promise<boolean> {
  const session = await getStaffSession(req);
  if (!session) {
    sendInvalid(res, 401, "Нэвтрэх шаардлагатай");
    return false;
  }
  if (session.role !== "admin" && session.role !== "hr") {
    sendInvalid(res, 403, "Зөвхөн админ эсвэл хүний нөөцийн ажилтан хандах эрхтэй");
    return false;
  }
  return true;
}

async function officeIp(): Promise<string | null> {
  const [network] = await db.select({ officeIp: officeAttendanceNetworkTable.officeIp })
    .from(officeAttendanceNetworkTable)
    .where(eq(officeAttendanceNetworkTable.id, 1));
  return network?.officeIp ?? null;
}

async function requireOfficeNetwork(
  req: Parameters<Parameters<IRouter["post"]>[1]>[0],
  res: Parameters<Parameters<IRouter["post"]>[1]>[1],
): Promise<boolean> {
  if (!isOfficeNetworkRequest(req.headers, await officeIp())) {
    sendInvalid(res, 403, INVALID_NETWORK_ERROR);
    return false;
  }
  return true;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function responseState(
  employeeId: number,
  officeDate: string,
  punch?: typeof officeAttendancePunchesTable.$inferSelect,
) {
  return {
    employeeId,
    officeDate,
    state: !punch ? "not-checked-in" as const
      : punch.checkedOutAt ? "checked-out" as const : "checked-in" as const,
    checkedInAt: punch?.checkedInAt?.toISOString() ?? null,
    checkedOutAt: punch?.checkedOutAt?.toISOString() ?? null,
    attendanceId: punch?.attendanceId ?? null,
  };
}

async function lockEmployee(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], employeeId: number): Promise<boolean> {
  const locked = await tx.execute(sql`SELECT id FROM employees WHERE id = ${employeeId} FOR UPDATE`);
  return locked.rows.length > 0;
}

async function authenticateDevice(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: { deviceId: number; timestamp: number; nonce: string; signature: string },
  action: "status" | "check-in" | "check-out",
): Promise<{ device: typeof attendanceDevicesTable.$inferSelect; employee: typeof employeesTable.$inferSelect } | null> {
  if (!isFreshTimestamp(input.timestamp)) return null;
  const [device] = await tx.select().from(attendanceDevicesTable)
    .where(eq(attendanceDevicesTable.id, input.deviceId)).for("update");
  if (!device || device.revokedAt) return null;
  const [employee] = await tx.select().from(employeesTable).where(eq(employeesTable.id, device.employeeId));
  if (!employee || employee.status !== "active") return null;
  const publicKey = device.publicKey as { kty: "EC"; crv: "P-256"; x: string; y: string };
  if (!verifyP256Signature(
    publicKey,
    deviceSigningText(action, device.id, input.timestamp, input.nonce),
    input.signature,
  )) return null;
  const [acceptedNonce] = await tx.insert(officeAttendanceNoncesTable).values({
    deviceId: device.id,
    nonceHash: nonceDigest(input.nonce),
  }).onConflictDoNothing({
    target: [officeAttendanceNoncesTable.deviceId, officeAttendanceNoncesTable.nonceHash],
  }).returning({ id: officeAttendanceNoncesTable.id });
  if (!acceptedNonce) return null;
  await tx.update(attendanceDevicesTable).set({ lastUsedAt: new Date() })
    .where(eq(attendanceDevicesTable.id, device.id));
  return { device, employee };
}

async function getDeviceState(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  employeeId: number,
  today: string,
) {
  const [pending] = await tx.select().from(officeAttendancePunchesTable)
    .where(and(
      eq(officeAttendancePunchesTable.employeeId, employeeId),
      isNull(officeAttendancePunchesTable.checkedOutAt),
      isNull(officeAttendancePunchesTable.cancelledAt),
    ))
    .orderBy(desc(officeAttendancePunchesTable.checkedInAt))
    .limit(1);
  if (pending) return responseState(employeeId, pending.officeDate, pending);
  const [completed] = await tx.select().from(officeAttendancePunchesTable)
    .where(and(
      eq(officeAttendancePunchesTable.employeeId, employeeId),
      eq(officeAttendancePunchesTable.officeDate, today),
      isNotNull(officeAttendancePunchesTable.checkedOutAt),
      isNull(officeAttendancePunchesTable.cancelledAt),
    ))
    .orderBy(desc(officeAttendancePunchesTable.checkedOutAt))
    .limit(1);
  return responseState(employeeId, today, completed);
}

router.get("/attendance/office-pending", async (req, res): Promise<void> => {
  if (!await requireAttendanceStaff(req, res)) return;
  const rows = await db.select({
    id: officeAttendancePunchesTable.id,
    employeeId: officeAttendancePunchesTable.employeeId,
    employeeName: employeesTable.name,
    deviceId: officeAttendancePunchesTable.deviceId,
    deviceName: attendanceDevicesTable.name,
    officeDate: officeAttendancePunchesTable.officeDate,
    checkedInAt: officeAttendancePunchesTable.checkedInAt,
    createdAt: officeAttendancePunchesTable.createdAt,
  }).from(officeAttendancePunchesTable)
    .innerJoin(employeesTable, eq(employeesTable.id, officeAttendancePunchesTable.employeeId))
    .innerJoin(attendanceDevicesTable, eq(attendanceDevicesTable.id, officeAttendancePunchesTable.deviceId))
    .where(and(
      isNull(officeAttendancePunchesTable.checkedOutAt),
      isNull(officeAttendancePunchesTable.cancelledAt),
    ))
    .orderBy(desc(officeAttendancePunchesTable.checkedInAt));
  res.json(ListOfficeAttendancePendingPunchesResponse.parse(rows.map((row) => ({
    ...row,
    checkedInAt: row.checkedInAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }))));
});

router.post("/attendance/office-pending/:id/cancel", async (req, res): Promise<void> => {
  if (!await requireAttendanceStaff(req, res)) return;
  const params = CancelOfficeAttendancePendingPunchParams.safeParse(req.params);
  const body = CancelOfficeAttendancePendingPunchBody.safeParse(req.body);
  if (!params.success || !body.success || body.data.reason.trim().length === 0) {
    sendInvalid(res, 400, !params.success ? params.error.message
      : !body.success ? body.error.message : "Цуцлах шалтгаан хоосон байж болохгүй");
    return;
  }
  const session = await getStaffSession(req);
  if (!session) {
    sendInvalid(res, 401, "Нэвтрэх шаардлагатай");
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [initialPunch] = await tx.select().from(officeAttendancePunchesTable)
      .where(eq(officeAttendancePunchesTable.id, params.data.id));
    if (!initialPunch) return { kind: "not-found" as const };
    if (initialPunch.checkedOutAt || initialPunch.cancelledAt) return { kind: "already-resolved" as const };
    if (!await lockEmployee(tx, initialPunch.employeeId)) return { kind: "not-found" as const };
    const [punch] = await tx.select().from(officeAttendancePunchesTable)
      .where(eq(officeAttendancePunchesTable.id, initialPunch.id))
      .for("update");
    if (!punch) return { kind: "not-found" as const };
    if (punch.checkedOutAt || punch.cancelledAt) return { kind: "already-resolved" as const };
    const cancelledAt = new Date();
    const reason = body.data.reason.trim();
    const [cancelled] = await tx.update(officeAttendancePunchesTable)
      .set({
        cancelledAt,
        cancelledBy: session.id,
        cancellationReason: reason,
      })
      .where(and(
        eq(officeAttendancePunchesTable.id, punch.id),
        isNull(officeAttendancePunchesTable.checkedOutAt),
        isNull(officeAttendancePunchesTable.cancelledAt),
      ))
      .returning();
    if (!cancelled) return { kind: "already-resolved" as const };
    return { kind: "cancelled" as const, cancelledAt, id: cancelled.id, reason };
  });
  if (result.kind === "not-found") {
    sendInvalid(res, 404, "Хүлээгдэж буй утасны ирц олдсонгүй");
    return;
  }
  if (result.kind === "already-resolved") {
    sendInvalid(res, 409, "Утасны ирц аль хэдийн дууссан эсвэл цуцлагдсан байна");
    return;
  }
  res.json(CancelOfficeAttendancePendingPunchResponse.parse({
    id: result.id,
    cancelledAt: result.cancelledAt.toISOString(),
    cancelledBy: session.id,
    reason: result.reason,
  }));
});

router.get("/attendance/office-network", async (req, res): Promise<void> => {
  if (!await requireAttendanceStaff(req, res)) return;
  const response = GetOfficeAttendanceNetworkResponse.parse({ officeIp: await officeIp() });
  res.json(response);
});

router.put("/attendance/office-network", async (req, res): Promise<void> => {
  if (!await requireAttendanceStaff(req, res)) return;
  const parsed = SetOfficeAttendanceNetworkBody.safeParse(req.body);
  if (!parsed.success) {
    sendInvalid(res, 400, parsed.error.message);
    return;
  }
  const normalizedIp = normalizeConfiguredIp(parsed.data.officeIp);
  if (!normalizedIp) {
    sendInvalid(res, 400, "Оффисын IP хаяг буруу байна");
    return;
  }
  const session = await getStaffSession(req);
  if (!session) {
    sendInvalid(res, 401, "Нэвтрэх шаардлагатай");
    return;
  }
  await db.insert(officeAttendanceNetworkTable).values({
    id: 1,
    officeIp: normalizedIp,
    updatedBy: session.id,
  }).onConflictDoUpdate({
    target: officeAttendanceNetworkTable.id,
    set: { officeIp: normalizedIp, updatedBy: session.id, updatedAt: new Date() },
  });
  res.json(SetOfficeAttendanceNetworkResponse.parse({ officeIp: normalizedIp }));
});

router.get("/attendance/device-enrollments", async (req, res): Promise<void> => {
  if (!await requireAttendanceStaff(req, res)) return;
  const rows = await db.select({
    id: attendanceDeviceEnrollmentsTable.id,
    employeeId: attendanceDeviceEnrollmentsTable.employeeId,
    expiresAt: attendanceDeviceEnrollmentsTable.expiresAt,
    usedAt: attendanceDeviceEnrollmentsTable.usedAt,
    revokedAt: attendanceDeviceEnrollmentsTable.revokedAt,
    createdAt: attendanceDeviceEnrollmentsTable.createdAt,
  }).from(attendanceDeviceEnrollmentsTable).orderBy(desc(attendanceDeviceEnrollmentsTable.createdAt));
  res.json(ListAttendanceDeviceEnrollmentsResponse.parse(rows.map((row) => ({
    ...row,
    expiresAt: row.expiresAt.toISOString(),
    usedAt: row.usedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }))));
});

router.post("/attendance/device-enrollments", async (req, res): Promise<void> => {
  if (!await requireAttendanceStaff(req, res)) return;
  const parsed = CreateAttendanceDeviceEnrollmentBody.safeParse(req.body);
  if (!parsed.success) {
    sendInvalid(res, 400, parsed.error.message);
    return;
  }
  const [employee] = await db.select().from(employeesTable)
    .where(eq(employeesTable.id, parsed.data.employeeId));
  if (!employee || employee.status !== "active") {
    sendInvalid(res, 404, "Идэвхтэй ажилтан олдсонгүй");
    return;
  }
  const session = await getStaffSession(req);
  if (!session) {
    sendInvalid(res, 401, "Нэвтрэх шаардлагатай");
    return;
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ENROLLMENT_LIFETIME_MS);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const [enrollment] = await db.transaction(async (tx) => {
    await tx.update(attendanceDeviceEnrollmentsTable)
      .set({ revokedAt: now })
      .where(and(
        eq(attendanceDeviceEnrollmentsTable.employeeId, employee.id),
        isNull(attendanceDeviceEnrollmentsTable.usedAt),
        isNull(attendanceDeviceEnrollmentsTable.revokedAt),
      ));
    return tx.insert(attendanceDeviceEnrollmentsTable).values({
      employeeId: employee.id,
      tokenHash,
      createdBy: session.id,
      expiresAt,
    }).returning();
  });
  res.status(201).json(CreateAttendanceDeviceEnrollmentResponse.parse({
    id: enrollment.id,
    employeeId: enrollment.employeeId,
    token,
    expiresAt: enrollment.expiresAt.toISOString(),
  }));
});

router.get("/attendance/devices", async (req, res): Promise<void> => {
  if (!await requireAttendanceStaff(req, res)) return;
  const rows = await db.select({
    id: attendanceDevicesTable.id,
    employeeId: attendanceDevicesTable.employeeId,
    employeeName: employeesTable.name,
    name: attendanceDevicesTable.name,
    createdAt: attendanceDevicesTable.createdAt,
    lastUsedAt: attendanceDevicesTable.lastUsedAt,
    revokedAt: attendanceDevicesTable.revokedAt,
  }).from(attendanceDevicesTable)
    .innerJoin(employeesTable, eq(employeesTable.id, attendanceDevicesTable.employeeId))
    .orderBy(desc(attendanceDevicesTable.createdAt));
  res.json(ListAttendanceDevicesResponse.parse(rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  }))));
});

router.delete("/attendance/devices/:id", async (req, res): Promise<void> => {
  if (!await requireAttendanceStaff(req, res)) return;
  const parsed = RevokeAttendanceDeviceParams.safeParse(req.params);
  if (!parsed.success) {
    sendInvalid(res, 400, parsed.error.message);
    return;
  }
  const [revoked] = await db.update(attendanceDevicesTable)
    .set({ revokedAt: new Date() })
    .where(eq(attendanceDevicesTable.id, parsed.data.id))
    .returning({ id: attendanceDevicesTable.id });
  if (!revoked) {
    sendInvalid(res, 404, "Төхөөрөмж олдсонгүй");
    return;
  }
  res.status(204).send();
});

router.post("/attendance/device/register", async (req, res): Promise<void> => {
  if (!await requireOfficeNetwork(req, res)) return;
  const parsed = RegisterAttendanceDeviceBody.safeParse(req.body);
  if (!parsed.success) {
    sendInvalid(res, 400, parsed.error.message);
    return;
  }
  const input = parsed.data;
  if (!isFreshTimestamp(input.timestamp)
    || !verifyP256Signature(
      input.publicKey,
      enrollmentSigningText(input.token, input.timestamp, input.nonce),
      input.signature,
    )) {
    sendInvalid(res, 401, "Нотлох гарын үсэг эсвэл цаг хүчингүй байна");
    return;
  }
  const tokenHash = createHash("sha256").update(input.token, "utf8").digest("hex");
  try {
    const registered = await db.transaction(async (tx) => {
      const [enrollment] = await tx.select().from(attendanceDeviceEnrollmentsTable)
        .where(eq(attendanceDeviceEnrollmentsTable.tokenHash, tokenHash))
        .for("update");
      const now = new Date();
      if (!enrollment || enrollment.usedAt || enrollment.revokedAt || enrollment.expiresAt <= now) {
        return null;
      }
      const [employee] = await tx.select().from(employeesTable)
        .where(eq(employeesTable.id, enrollment.employeeId));
      if (!employee || employee.status !== "active") return null;
      const [device] = await tx.insert(attendanceDevicesTable).values({
        employeeId: employee.id,
        publicKey: input.publicKey,
        name: input.name,
      }).returning();
      await tx.update(attendanceDeviceEnrollmentsTable)
        .set({ usedAt: now })
        .where(and(
          eq(attendanceDeviceEnrollmentsTable.id, enrollment.id),
          isNull(attendanceDeviceEnrollmentsTable.usedAt),
        ));
      return device;
    });
    if (!registered) {
      sendInvalid(res, 409, "Бүртгэлийн токен хүчингүй, ашиглагдсан эсвэл хугацаа дууссан байна");
      return;
    }
    res.status(201).json(RegisterAttendanceDeviceResponse.parse({
      deviceId: registered.id,
      employeeId: registered.employeeId,
      name: registered.name,
      registeredAt: registered.createdAt.toISOString(),
    }));
  } catch (error) {
    if (isUniqueViolation(error)) {
      sendInvalid(res, 409, "Бүртгэлийн токен аль хэдийн ашиглагдсан байна");
      return;
    }
    throw error;
  }
});

router.post("/attendance/device/status", async (req, res): Promise<void> => {
  if (!await requireOfficeNetwork(req, res)) return;
  const parsed = GetAttendanceDeviceStatusBody.safeParse(req.body);
  if (!parsed.success) {
    sendInvalid(res, 400, parsed.error.message);
    return;
  }
  const today = officeCalendarDate(new Date());
  const state = await db.transaction(async (tx) => {
    const authenticated = await authenticateDevice(tx, parsed.data, "status");
    if (!authenticated) return null;
    return getDeviceState(tx, authenticated.employee.id, today);
  });
  if (!state) {
    sendInvalid(res, 401, INVALID_DEVICE_ERROR);
    return;
  }
  res.json(GetAttendanceDeviceStatusResponse.parse(state));
});

router.post("/attendance/device/punch", async (req, res): Promise<void> => {
  if (!await requireOfficeNetwork(req, res)) return;
  const parsed = PunchAttendanceDeviceBody.safeParse(req.body);
  if (!parsed.success) {
    sendInvalid(res, 400, parsed.error.message);
    return;
  }
  const { action, ...signedRequest } = parsed.data;
  const serverNow = new Date();
  const today = officeCalendarDate(serverNow);
  try {
    const result = await db.transaction(async (tx) => {
      const authenticated = await authenticateDevice(tx, signedRequest, action);
      if (!authenticated) return { kind: "unauthorized" as const };
      const employeeId = authenticated.employee.id;
      if (!await lockEmployee(tx, employeeId)) return { kind: "unauthorized" as const };

      const [pending] = await tx.select().from(officeAttendancePunchesTable)
        .where(and(
          eq(officeAttendancePunchesTable.employeeId, employeeId),
          isNull(officeAttendancePunchesTable.checkedOutAt),
          isNull(officeAttendancePunchesTable.cancelledAt),
        ))
        .for("update")
        .limit(1);

      if (action === "check-in") {
        if (pending) return { kind: "conflict" as const, message: "Ажил эхэлсэн бүртгэл нээлттэй байна" };
        const [existing] = await tx.select({ id: attendanceTable.id })
          .from(attendanceTable)
          .where(and(
            eq(attendanceTable.employeeId, employeeId),
            eq(attendanceTable.date, today),
          ))
          .limit(1);
        if (existing) {
          return { kind: "conflict" as const, message: "Энэ өдөр HR эсвэл өөр attendance бүртгэл байна" };
        }
        const [punch] = await tx.insert(officeAttendancePunchesTable).values({
          employeeId,
          deviceId: authenticated.device.id,
          officeDate: today,
          checkedInAt: serverNow,
        }).returning();
        return { kind: "ok" as const, state: responseState(employeeId, today, punch) };
      }

      if (!pending) {
        return { kind: "conflict" as const, message: "Эхлэх бүртгэлгүй үед тарах бүртгэл хийх боломжгүй" };
      }
      if (serverNow.getTime() <= pending.checkedInAt.getTime()) {
        return { kind: "conflict" as const, message: "Тарах цаг эхлэх цагаас хойш байх ёстой" };
      }
      if (serverNow.getTime() - pending.checkedInAt.getTime() > 24 * 60 * 60 * 1000) {
        return { kind: "conflict" as const, message: "Ирснээс хойш 24 цагаас хэтэрсэн тул HR нээлттэй ирцийг шалгаж цуцлах шаардлагатай" };
      }
      const [existing] = await tx.select({ id: attendanceTable.id })
        .from(attendanceTable)
        .where(and(
          eq(attendanceTable.employeeId, employeeId),
          eq(attendanceTable.date, pending.officeDate),
        ))
        .limit(1);
      if (existing) {
        return { kind: "conflict" as const, message: "Энэ өдөр HR attendance үүсгэсэн тул бүртгэлийг өөрчлөхгүй" };
      }
      const elapsedHours = Math.round(
        ((serverNow.getTime() - pending.checkedInAt.getTime()) / 3_600_000) * 100,
      ) / 100;
      const [attendance] = await tx.insert(attendanceTable).values({
        employeeId,
        date: pending.officeDate,
        clockIn: officeClockTime(pending.checkedInAt),
        clockOut: officeClockTime(serverNow),
        hours: elapsedHours,
        status: "present",
      }).returning();
      const [closedPunch] = await tx.update(officeAttendancePunchesTable)
        .set({ checkedOutAt: serverNow, attendanceId: attendance.id })
        .where(and(
          eq(officeAttendancePunchesTable.id, pending.id),
          isNull(officeAttendancePunchesTable.checkedOutAt),
        ))
        .returning();
      if (!closedPunch) throw new Error("Office attendance pending punch changed during checkout");
      return {
        kind: "ok" as const,
        state: responseState(employeeId, pending.officeDate, closedPunch),
      };
    });
    if (result.kind === "unauthorized") {
      sendInvalid(res, 401, INVALID_DEVICE_ERROR);
      return;
    }
    if (result.kind === "conflict") {
      sendInvalid(res, 409, result.message);
      return;
    }
    res.json(PunchAttendanceDeviceResponse.parse(result.state));
  } catch (error) {
    if (isUniqueViolation(error)) {
      sendInvalid(res, 409, "Ирцийн бүртгэл давхардсан байна");
      return;
    }
    throw error;
  }
});

export default router;