import { Router, type IRouter, type Response } from "express";
import { and, count, eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
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
] as const;

export async function bootstrapCanonicalUsers() {
  const [{ total }] = await db.select({ total: count() }).from(usersTable);
  if (total > 0) return;
  for (const canonical of canonicalUsers) {
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

function safeUser(user: { id: number; username: string; role: string }) {
  return { id: user.id, username: user.username, role: user.role };
}

async function requireAdmin(req: Parameters<typeof getStaffSession>[0], res: Response) {
  const session = await getStaffSession(req);
  if (!session) {
    res.status(401).json({ error: "Нэвтрэх шаардлагатай" });
    return null;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Зөвхөн админ хэрэглэгчийн тохиргоог удирдана" });
    return null;
  }
  return session;
}

router.get("/auth/me", async (req, res) => {
  const session = await getStaffSession(req);
  res.json(session
    ? { authenticated: true, id: session.id, username: session.username, role: session.role }
    : { authenticated: false, id: null, role: null, username: null });
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
  res.json({ authenticated: true, id: user.id, role: user.role, username: user.username });
});

router.post("/auth/logout", (_req, res) => {
  res.clearCookie(hrCookie.name, { path: "/" });
  res.status(204).send();
});

router.get("/users", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const users = await db.select({ id: usersTable.id, username: usersTable.username, role: usersTable.role })
    .from(usersTable).orderBy(usersTable.id);
  res.json(users.map(safeUser));
});

router.put("/users/:id", async (req, res) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const id = Number(req.params.id);
  const username = typeof req.body?.username === "string" ? req.body.username.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
  const role = req.body?.role;
  const newPassword = req.body?.newPassword;
  if (!Number.isInteger(id) || !username || !isStaffRole(role) || (newPassword !== undefined && (typeof newPassword !== "string" || !newPassword))) {
    res.status(400).json({ error: "Хэрэглэгчийн мэдээлэл буруу байна" });
    return;
  }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Хэрэглэгч олдсонгүй" });
    return;
  }
  if (target.role === "admin" && role !== "admin") {
    const [{ total }] = await db.select({ total: count() }).from(usersTable).where(eq(usersTable.role, "admin"));
    if (total <= 1) {
      res.status(400).json({ error: "Сүүлийн админы эрхийг өөрчилж болохгүй" });
      return;
    }
  }
  const normalizedUsername = normalizeUsername(username);
  const [sameName] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.normalizedUsername, normalizedUsername));
  if (sameName && sameName.id !== id) {
    res.status(409).json({ error: "Энэ хэрэглэгчийн нэр ашиглагдаж байна" });
    return;
  }
  const values: { username: string; normalizedUsername: string; role: string; tokenVersion: number; passwordHash?: string } = {
    username, normalizedUsername, role, tokenVersion: target.tokenVersion + 1,
  };
  if (newPassword) values.passwordHash = await hashPassword(newPassword);
  const [updated] = await db.update(usersTable).set(values).where(eq(usersTable.id, id))
    .returning({ id: usersTable.id, username: usersTable.username, role: usersTable.role });
  res.json(safeUser(updated!));
});

router.delete("/users/:id", async (req, res) => {
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
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Хэрэглэгч олдсонгүй" });
    return;
  }
  if (target.role === "admin") {
    const [{ total }] = await db.select({ total: count() }).from(usersTable).where(eq(usersTable.role, "admin"));
    if (total <= 1) {
      res.status(400).json({ error: "Сүүлийн админыг устгах боломжгүй" });
      return;
    }
  }
  await db.delete(usersTable).where(and(eq(usersTable.id, id)));
  res.status(204).send();
});

export default router;