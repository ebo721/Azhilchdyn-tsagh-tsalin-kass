import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { createHrSession, getHrRole, hrCookie } from "../lib/hr-session";

const router: IRouter = Router();

router.get("/auth/me", (req, res) => {
  const role = getHrRole(req);
  res.json(role ? { authenticated: true, role, username: "sahr" } : { authenticated: false, role: null, username: null });
});

router.post("/auth/login", (req, res) => {
  const configuredPassword = process.env["HR_MANAGER_PASSWORD"];
  if (!configuredPassword) {
    res.status(503).json({ error: "HR manager login is not configured" });
    return;
  }
  const username = typeof req.body?.username === "string" ? req.body.username : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const supplied = Buffer.from(password);
  const expected = Buffer.from(configuredPassword);
  const passwordMatches = supplied.length === expected.length && timingSafeEqual(supplied, expected);
  if (username !== "sahr" || !passwordMatches) {
    res.status(401).json({ error: "Нэвтрэх нэр эсвэл нууц үг буруу байна" });
    return;
  }
  res.cookie(hrCookie.name, createHrSession(), hrCookie.options);
  res.json({ authenticated: true, role: "hr", username: "sahr" });
});

router.post("/auth/logout", (_req, res) => {
  res.clearCookie(hrCookie.name, { path: "/" });
  res.status(204).send();
});

export default router;