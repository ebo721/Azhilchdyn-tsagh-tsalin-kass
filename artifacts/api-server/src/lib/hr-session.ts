import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request } from "express";
import { db, usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";

const COOKIE_NAME = "staff_ops_hr";
const SESSION_SECONDS = 8 * 60 * 60;

function secret() {
  const value = process.env["SESSION_SECRET"];
  if (!value) throw new Error("SESSION_SECRET is required");
  return value;
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export type StaffRole = "admin" | "hr" | "accountant" | "warehouse" | "viewer" | "technologist";
const roles: readonly StaffRole[] = ["admin", "hr", "accountant", "warehouse", "viewer", "technologist"];
const scrypt = promisify(scryptCallback);

export function normalizeUsername(username: string) {
  return username.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && roles.includes(value as StaffRole);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const [algorithm, saltValue, hashValue] = passwordHash.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  try {
    const expected = Buffer.from(hashValue, "base64url");
    const actual = await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createStaffSession(user: Pick<User, "id" | "role" | "tokenVersion">): string;
/** @deprecated Sessions must be created from a database user. */
export function createStaffSession(role: StaffRole): string;
export function createStaffSession(user: Pick<User, "id" | "role" | "tokenVersion"> | StaffRole) {
  const sessionUser = typeof user === "string" ? { id: 0, role: user, tokenVersion: 0 } : user;
  const payload = Buffer.from(JSON.stringify({ userId: sessionUser.id, role: sessionUser.role, tokenVersion: sessionUser.tokenVersion, exp: Date.now() + SESSION_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export async function getStaffSession(req: Request): Promise<Pick<User, "id" | "username" | "role" | "tokenVersion"> | null> {
  const rawCookie = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  const token = rawCookie?.slice(COOKIE_NAME.length + 1);
  if (!token) return null;
  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature) return null;
  const expected = signature(payload);
  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { userId?: number; tokenVersion?: number; exp?: number };
    if (typeof data.userId !== "number" || !Number.isInteger(data.userId) || typeof data.tokenVersion !== "number" || !Number.isInteger(data.tokenVersion) || typeof data.exp !== "number" || data.exp <= Date.now()) return null;
    const userId = data.userId;
    const [user] = await db.select({
      id: usersTable.id,
      username: usersTable.username,
      role: usersTable.role,
      tokenVersion: usersTable.tokenVersion,
    }).from(usersTable).where(eq(usersTable.id, userId));
    return user && isStaffRole(user.role) && user.tokenVersion === data.tokenVersion ? user as Pick<User, "id" | "username" | "role" | "tokenVersion"> : null;
  } catch {
    return null;
  }
}

export async function getStaffRole(req: Request): Promise<StaffRole | null> {
  const session = await getStaffSession(req);
  return session?.role as StaffRole | undefined ?? null;
}

export const hrCookie = {
  name: COOKIE_NAME,
  options: {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env["NODE_ENV"] === "production",
    maxAge: SESSION_SECONDS * 1000,
    path: "/",
  },
};