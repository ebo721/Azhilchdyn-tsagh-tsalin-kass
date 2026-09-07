import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { createStaffSession, getStaffRole, hrCookie, type StaffRole } from "../lib/hr-session";

const router: IRouter = Router();

router.get("/auth/me", (req, res) => {
  const role = getStaffRole(req);
  res.json(role ? { authenticated: true, role, username: role === "admin" ? "admin" : "sahr" } : { authenticated: false, role: null, username: null });
});

router.post("/auth/login", (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username : "";
  const role: StaffRole | null = username === "admin" ? "admin" : username === "sahr" ? "hr" : null;
  const configuredPassword = role === "admin" ? process.env["ADMIN_PASSWORD"] : role === "hr" ? process.env["HR_MANAGER_PASSWORD"] : undefined;
  if (role && !configuredPassword) {
    res.status(503).json({ error: "Login is not configured" });
    return;
  }
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const supplied = Buffer.from(password);
  const expected = Buffer.from(configuredPassword ?? "");
  const passwordMatches = supplied.length === expected.length && timingSafeEqual(supplied, expected);
  if (!role || !passwordMatches) {
    res.status(401).json({ error: "Нэвтрэх нэр эсвэл нууц үг буруу байна" });
    return;
  }
  res.cookie(hrCookie.name, createStaffSession(role), hrCookie.options);
  res.json({ authenticated: true, role, username });
});

router.post("/auth/logout", (_req, res) => {
  res.clearCookie(hrCookie.name, { path: "/" });
  res.status(204).send();
});

export default router;