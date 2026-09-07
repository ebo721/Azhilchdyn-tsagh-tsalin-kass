import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

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

export function createHrSession() {
  const payload = Buffer.from(JSON.stringify({ role: "hr", exp: Date.now() + SESSION_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function getHrRole(req: Request): "hr" | null {
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
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { role?: string; exp?: number };
    return data.role === "hr" && typeof data.exp === "number" && data.exp > Date.now() ? "hr" : null;
  } catch {
    return null;
  }
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