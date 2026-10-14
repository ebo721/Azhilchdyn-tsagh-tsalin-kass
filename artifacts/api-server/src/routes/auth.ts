import { Router, type IRouter, type Response } from "express";
import { count, eq, inArray, sql } from "drizzle-orm";
import { db, employeesTable, inventoryCustodianEmployeesTable, usersTable } from "@workspace/db";
import { CreateUserBody, accessibleMenuPaths, validMenuSelection } from "@workspace/api-zod";
import {
  createStaffSession,
  getStaffSession,
  hashPassword,
  hrCookie,
  isStaffRole,
  normalizeUsername,
  verifyPassword,
} from "../lib/hr-session.js";

const router: IRouter = Router();

const canonicalUsers = [
  { username: "admin", role: "admin", passwordVariable: "ADMIN_PASSWORD" },
  { username: "sahr", role: "hr", passwordVariable: "HR_MANAGER_PASSWORD" },
  { username: "saacc", role: "accountant", passwordVariable: "ACCOUNTANT_PASSWORD" },
  { username: "satre", role: "warehouse", passwordVariable: "WAREHOUSE_PASSWORD" },
  { username: "sasta", role: "viewer", passwordVariable: "SASTA_PASSWORD" },
  { username: "sate", role: "technologist", passwordVariable: "SATE_PASSWORD" },
] as const;

export async function bootstrapCanonicalUsers() {
  const [{ total }] = await db.select({ total: count() }).from(usersTable);
  // Preserve the historical empty-database bootstrap, but on populated
  // databases only reconcile sate. This must not resurrect deleted accounts.
  const usersToBootstrap = total > 0
    ? canonicalUsers.filter((canonical) => canonical.username === "sate")
    : canonicalUsers;
  for (const canonical of usersToBootstrap) {
    const password = process.env[canonical.passwordVariable];
    if (!password) continue;
    const normalizedUsername = normalizeUsername(canonical.username);
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.normalizedUsername, normalizedUsername));
    if (!existing) {
      await db.insert(usersTable).values({
        username: canonical.username,
        normalizedUsername,
        role: canonical.role,
        passwordHash: await hashPassword(password),
      }).onConflictDoNothing();
    }
  }
}

function safeUser(user: { id: number; username: string; role: string; fullName?: string | null; menuPaths?: string[] | null }, custodianEmployeeIds: number[] = []) {
  return { id: user.id, username: user.username, role: user.role, fullName: user.fullName ?? null, menuPaths: user.menuPaths ?? null, custodianEmployeeIds };
}

type UserTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
class AccountError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
async function lockAdminChanges(tx: UserTransaction, actor: { id: number; tokenVersion: number }) {
  // Serialize create/edit/delete, including concurrent last-admin demotions.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('staff-ops:user-management', 0))`);
  const [current] = await tx.select().from(usersTable).where(eq(usersTable.id, actor.id));
  if (!current || current.role !== "admin" || current.tokenVersion !== actor.tokenVersion) {
    throw new AccountError(403, "Хэрэглэгч удирдах эрх өөрчлөгдсөн байна. Дахин нэвтэрнэ үү");
  }
}
async function checkCustodians(tx: UserTransaction, ids?: number[]) {
  if (!ids?.length) return;
  const employees = await tx.select({ id: employeesTable.id }).from(employeesTable).where(inArray(employeesTable.id, ids)).for("share");
  if (employees.length !== ids.length) throw new AccountError(400, "Сонгосон ажилтан олдсонгүй");
}
function accountError(error: unknown, res: Response, next: (error: unknown) => void) {
  if (error instanceof AccountError) { res.status(error.status).json({ error: error.message }); return; }
  const pg = error as { code?: string; cause?: { code?: string } };
  const code = pg?.code ?? pg?.cause?.code;
  if (code === "23505") { res.status(409).json({ error: "Энэ хэрэглэгчийн нэр ашиглагдаж байна" }); return; }
  if (code === "23503" || code === "23001") {
    res.status(409).json({ error: "Энэ хэрэглэгч баримтын түүхтэй холбогдсон тул устгах боломжгүй" }); return;
  }
  next(error);
}

async function requireAdmin(req: Parameters<typeof getStaffSession>[0], res: Response) {
  const session = await getStaffSession(req);
  if (!session) {
    res.status(401).json({ error: "Нэвтрэх шаардлагатай" });
    return null;
  }
  if (session.role !== "admin" || (session.menuPaths !== null && !session.menuPaths.includes("/users"))) {
    res.status(403).json({ error: "Зөвхөн админ хэрэглэгчийн тохиргоог удирдана" });
    return null;
  }
  return session;
}

router.get("/auth/me", async (req, res) => {
  const session = await getStaffSession(req);
  res.json(session
    ? { authenticated: true, id: session.id, username: session.username, role: session.role, menuPaths: session.menuPaths }
    : { authenticated: false, id: null, role: null, username: null, menuPaths: null });
});

router.post("/auth/login", async (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const normalizedUsername = normalizeUsername(username);
  const [user] = normalizedUsername
    ? await db.select().from(usersTable).where(eq(usersTable.normalizedUsername, normalizedUsername))
    : [];
  if (!user || !isStaffRole(user.role) || !(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: "Нэвтрэх нэр эсвэл нууц үг буруу байна" });
    return;
  }
  res.cookie(hrCookie.name, createStaffSession(user), hrCookie.options);
  res.json({ authenticated: true, id: user.id, role: user.role, username: user.username, menuPaths: user.menuPaths });
});

router.post("/auth/logout", (_req, res) => {
  res.clearCookie(hrCookie.name, { path: "/" });
  res.status(204).send();
});

router.get("/users", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const users = await db.select({ id: usersTable.id, username: usersTable.username, role: usersTable.role, fullName: usersTable.fullName, menuPaths: usersTable.menuPaths })
    .from(usersTable).orderBy(usersTable.id);
  const links = await db.select().from(inventoryCustodianEmployeesTable);
  res.json(users.map((user) => safeUser(user, links.filter((link) => link.userId === user.id).map((link) => link.employeeId))));
});

router.post("/users", async (req, res, next) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Нэр, эрх болон 8–128 тэмдэгттэй нууц үг оруулна уу" }); return; }
  const input = parsed.data;
  const username = input.username.normalize("NFKC").trim().replace(/\s+/g, " ");
  const menuPaths = input.menuPaths ?? null;
  if (!username || username.length > 80 || !validMenuSelection(input.role, menuPaths)
    || (input.custodianEmployeeIds !== undefined && (input.role !== "warehouse"
      || new Set(input.custodianEmployeeIds).size !== input.custodianEmployeeIds.length))) {
    res.status(400).json({ error: "Хэрэглэгчийн эрхэд багтах цэс, хариуцагчийг сонгоно уу. Админы тохиргоо цэсийг хасахгүй" });
    return;
  }
  try {
    const passwordHash = await hashPassword(input.password);
    const user = await db.transaction(async tx => {
      await lockAdminChanges(tx, actor);
      await checkCustodians(tx, input.custodianEmployeeIds);
      const [created] = await tx.insert(usersTable).values({
        username, normalizedUsername: normalizeUsername(username), role: input.role, passwordHash,
        fullName: input.fullName?.normalize("NFKC").trim().replace(/\s+/g, " ") || null, menuPaths,
      }).returning();
      if (input.custodianEmployeeIds?.length) {
        await tx.insert(inventoryCustodianEmployeesTable).values(input.custodianEmployeeIds.map(employeeId => ({ userId: created.id, employeeId })));
      }
      return safeUser(created, input.custodianEmployeeIds);
    });
    res.status(201).json(user);
  } catch (error) { accountError(error, res, next); }
});

router.put("/users/:id", async (req, res, next) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const id = Number(req.params.id);
  const username = typeof req.body?.username === "string" ? req.body.username.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
  const role = req.body?.role;
  const newPassword = req.body?.newPassword;
  const rawName = req.body?.fullName;
  const employeeIds = req.body?.custodianEmployeeIds;
  const menuPaths = req.body?.menuPaths;
  if (employeeIds !== undefined && (!Array.isArray(employeeIds) || employeeIds.length > 1000
    || employeeIds.some((id: unknown) => !Number.isInteger(id) || Number(id) <= 0)
    || new Set(employeeIds).size !== employeeIds.length || role !== "warehouse")) {
    res.status(400).json({ error: "Няравуудыг ажилчдын жагсаалтаас сонгоно уу" });
    return;
  }
  if (rawName !== undefined && rawName !== null && (typeof rawName !== "string" || rawName.length > 120)) {
    res.status(400).json({ error: "Няравын нэр 120 тэмдэгтээс хэтрэхгүй байна" });
    return;
  }
  const fullName = typeof rawName === "string" ? rawName.normalize("NFKC").trim().replace(/\s+/g, " ") || null : rawName;
  if (!Number.isInteger(id) || id <= 0 || !username || !isStaffRole(role) || (newPassword !== undefined && (typeof newPassword !== "string" || !newPassword || newPassword.length > 128))) {
    res.status(400).json({ error: "Хэрэглэгчийн мэдээлэл буруу байна" });
    return;
  }
  if (menuPaths !== undefined && !validMenuSelection(role, menuPaths)) {
    res.status(400).json({ error: "Хэрэглэгчийн эрхэд багтах цэсийг сонгоно уу. Админы тохиргоо цэсийг хасахгүй" });
    return;
  }
  try {
    const passwordHash = newPassword ? await hashPassword(newPassword) : undefined;
    const result = await db.transaction(async (tx) => {
      await lockAdminChanges(tx, actor);
      const [target] = await tx.select().from(usersTable).where(eq(usersTable.id, id));
      if (!target) throw new AccountError(404, "Хэрэглэгч олдсонгүй");
      if (target.role === "admin" && role !== "admin") {
        const [{ total }] = await tx.select({ total: count() }).from(usersTable).where(eq(usersTable.role, "admin"));
        if (total <= 1) throw new AccountError(400, "Сүүлийн админы эрхийг өөрчилж болохгүй");
      }
      await checkCustodians(tx, employeeIds);
      const selected = menuPaths !== undefined ? menuPaths
        : target.menuPaths === null ? null : accessibleMenuPaths(role, target.menuPaths);
      // Old clients changing a role must not retain disallowed menu assignments.
      if (role === "admin" && selected !== null && !selected.includes("/users")) selected.push("/users");
      const [updated] = await tx.update(usersTable).set({
        username, normalizedUsername: normalizeUsername(username), role,
        tokenVersion: target.tokenVersion + 1, menuPaths: selected,
        ...(fullName !== undefined ? { fullName } : {}),
        ...(passwordHash ? { passwordHash } : {}),
      }).where(eq(usersTable.id, id)).returning();
      if (employeeIds !== undefined) {
        await tx.delete(inventoryCustodianEmployeesTable).where(eq(inventoryCustodianEmployeesTable.userId, id));
        if (employeeIds.length) await tx.insert(inventoryCustodianEmployeesTable).values(employeeIds.map((employeeId: number) => ({ userId: id, employeeId })));
      }
      const links = await tx.select().from(inventoryCustodianEmployeesTable).where(eq(inventoryCustodianEmployeesTable.userId, id));
      return safeUser(updated, links.map((link) => link.employeeId));
    });
    res.json(result);
  } catch (error) { accountError(error, res, next); }
});

router.delete("/users/:id", async (req, res, next) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Хэрэглэгчийн дугаар буруу байна" });
    return;
  }
  if (id === actor.id) {
    res.status(400).json({ error: "Өөрийн бүртгэлийг устгах боломжгүй" });
    return;
  }
  try {
    await db.transaction(async tx => {
      await lockAdminChanges(tx, actor);
      const [target] = await tx.select().from(usersTable).where(eq(usersTable.id, id));
      if (!target) throw new AccountError(404, "Хэрэглэгч олдсонгүй");
      if (target.role === "admin") {
        const [{ total }] = await tx.select({ total: count() }).from(usersTable).where(eq(usersTable.role, "admin"));
        if (total <= 1) throw new AccountError(400, "Сүүлийн админыг устгах боломжгүй");
      }
      await tx.delete(usersTable).where(eq(usersTable.id, id));
    });
    res.status(204).send();
  } catch (error) { accountError(error, res, next); }
});

export default router;