import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, deletionRequestsTable } from "@workspace/db";
import { getStaffSession, type StaffRole } from "../lib/hr-session.js";
const requireStaffAuth: RequestHandler = async (req, res, next) => {
  const session = await getStaffSession(req);
  if (!session) {
    res.status(401).json({ error: "Нэвтрэх шаардлагатай" });
    return;
  }
  if (req.method === "POST" && req.path === "/meal-counts/import") {
    if (session.role === "admin" || session.role === "warehouse") {
      next();
      return;
    }
    res.status(403).json({ error: "Зөвхөн админ эсвэл агуулахын ажилтан импорт хийнэ" });
    return;
  }
  // Meal technologists have a deliberately narrow meal workflow surface.
  // Keep this before deletion-request and other method-specific exceptions.
  if (session.role === "technologist") {
    const mealPrefix = (prefix: string) => req.path === prefix || req.path.startsWith(`${prefix}/`);
    if ((req.method === "GET" && req.path === "/inventory/material-requests/catalog")
      || (req.method === "POST" && req.path === "/inventory/material-requests")) {
      next();
      return;
    }
    if (req.method === "DELETE" && /^\/meals\/\d+$/.test(req.path)) {
      const requestId = Number(req.header("x-deletion-request-id"));
      if (!Number.isInteger(requestId)) { res.status(403).json({ error: "Устгах үйлдэлд админы баталсан хүсэлт шаардлагатай" }); return; }
      const [request] = await db.select().from(deletionRequestsTable).where(eq(deletionRequestsTable.id, requestId));
      if (!request || request.status !== "executing" || request.targetPath !== req.url) {
        res.status(403).json({ error: "Устгах хүсэлт хүчинтэй биш байна" }); return;
      }
      next();
      return;
    }
    if (req.method === "GET" && (mealPrefix("/meals") || mealPrefix("/meal-schedule") || mealPrefix("/meal-counts"))) {
      next();
      return;
    }
    if (
      (req.method === "POST" && (req.path === "/meals" || req.path === "/meal-schedule"
        || /^\/meals\/\d+\/ingredients$/.test(req.path)
        || /^\/meals\/\d+\/edit-request$/.test(req.path)))
      || ((req.method === "PUT" || req.method === "DELETE") && /^\/meals\/\d+\/ingredients\/\d+$/.test(req.path))
      || (req.method === "POST" && req.path === "/deletion-requests")
    ) {
      next();
      return;
    }
    res.status(403).json({ error: "Энэ хэсэгт хандах эрхгүй" });
    return;
  }
  if (req.path === "/chart-of-accounts" || req.path.startsWith("/chart-of-accounts/")) {
    if (req.method === "GET" || session.role === "admin") {
      next();
      return;
    }
    res.status(403).json({ error: "Дансны төлөвлөгөөг зөвхөн админ өөрчилнө" });
    return;
  }
  if (req.method === "POST" && req.path === "/deletion-requests") {
    next();
    return;
  }
  if (req.method === "DELETE" && session.role === "admin") {
    next();
    return;
  }
  if (req.method === "DELETE" && session.role === "accountant" && /^\/journal\/entries\/\d+$/.test(req.path)) {
    next();
    return;
  }
  if (req.method === "DELETE") {
    const requestId = Number(req.header("x-deletion-request-id"));
    if (!Number.isInteger(requestId)) {
      res.status(403).json({ error: "Устгах үйлдэлд админы баталсан хүсэлт шаардлагатай" });
      return;
    }
    void db.select().from(deletionRequestsTable).where(eq(deletionRequestsTable.id, requestId)).then(([request]) => {
      if (!request || request.status !== "executing" || request.targetPath !== req.url) {
        res.status(403).json({ error: "Устгах хүсэлт хүчинтэй биш байна" });
        return;
      }
      next();
    }).catch(next);
    return;
  }
  const role = session.role as StaffRole;
  if (role === "admin") {
    next();
    return;
  }
  const matchesPrefix = (prefix: string) => req.path === prefix || req.path.startsWith(`${prefix}/`);
  const viewerReadPrefixes = ["/employees", "/attendance", "/hour-balance", "/payroll", "/payroll-advance", "/cash", "/bank-accounts", "/bank-transactions", "/inventory", "/meals", "/meal-schedule", "/meal-counts", "/fixed-assets", "/operating-expenses", "/journal"];
  if (role === "viewer" && req.method === "GET" && viewerReadPrefixes.some(matchesPrefix)) {
    next();
    return;
  }
  if (role === "accountant" && (
    (req.method === "GET" && req.path === "/employees")
    || (req.method === "GET" && (
      req.path === "/attendance/shifts"
      || req.path === "/attendance/shift-plans"
    ))
    || (req.method === "PATCH" && req.path.startsWith("/employees/"))
    || matchesPrefix("/operating-expenses")
  )) {
    next();
    return;
  }
  if (req.method === "DELETE" && req.path.startsWith("/employees/")) {
    res.status(403).json({ error: "Ажилтан устгах зөвшөөрлийг зөвхөн ерөнхий админ өгнө" });
    return;
  }
  const allowedPrefixes = role === "hr"
    ? ["/employees", "/attendance", "/hour-balance", "/meal-counts"]
      : role === "accountant"
        ? ["/hour-balance", "/payroll", "/payroll-advance", "/payroll-schedule", "/cash", "/bank-accounts", "/bank-transactions", "/journal", "/meal-counts"]
      : role === "warehouse"
        ? ["/inventory", "/meals", "/meal-schedule", "/meal-counts", "/fixed-assets", "/operating-expenses"]
        : [];
  if (allowedPrefixes.some(matchesPrefix)) {
    next();
    return;
  }
  res.status(403).json({ error: "Энэ хэсэгт хандах эрхгүй" });
};

export default requireStaffAuth as RequestHandler;
