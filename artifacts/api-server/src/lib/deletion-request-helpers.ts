import { createServer } from "node:http";
import express, { type IRouter } from "express";
import type { StaffRole } from "./hr-session.js";

/**
 * Re-enters this router for an admin-approved deletion, the same way the original
 * request would have, but without hopping over the network to `127.0.0.1:PORT` —
 * that assumed a long-running server on a known port, which doesn't exist in a
 * serverless function (each invocation is isolated and PORT isn't set). Instead we
 * spin up a throwaway HTTP server bound to this router only for the duration of
 * this one call, so the exact same DELETE handlers and the header-based approval
 * check above run unchanged, in-process, on a loopback port the OS assigns us.
 */
export function dispatchApprovedDeletion(
  targetPath: string,
  cookie: string,
  requestId: number,
  targetRouter: IRouter,
): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(targetRouter);
    const server = createServer(app);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      fetch(`http://127.0.0.1:${port}${targetPath}`, {
        method: "DELETE",
        headers: { cookie, "x-deletion-request-id": String(requestId) },
      })
        .then((response) => resolve(response as { ok: boolean; status: number; text(): Promise<string> }))
        .catch(reject)
        .finally(() => server.close());
    });
  });
}

export const deletionTargetPatterns = [
  /^\/employees\/\d+$/,
  /^\/employees\/\d+\/salary-history\/\d+$/,
  /^\/attendance\/shifts\/\d+$/,
  /^\/attendance\?employeeId=\d+&date=\d{4}-\d{2}-\d{2}$/,
  /^\/payroll-advance\/approval\?month=\d{4}-\d{2}$/,
  /^\/payroll-adjustments\/\d{4}-\d{2}\/\d+\/transactions\/[12]$/,
  /^\/cash\/transactions\/\d+$/,
  /^\/bank-transactions\/\d+$/,
  /^\/fixed-assets\/\d+$/,
  /^\/inventory\/issues\/\d+$/,
  /^\/inventory\/purchases\/\d+$/,
  /^\/inventory\/suppliers\/\d+$/,
  /^\/meal-schedule\/\d+$/,
  /^\/meal-schedule\/slots\/\d+$/,
  /^\/meals\/\d+$/,
];
export const roleCanRequestDeletion = (role: StaffRole, targetPath: string) => role === "admin"
  || (role === "hr" && (targetPath.startsWith("/employees/") || targetPath.startsWith("/attendance")))
  || (role === "accountant" && (targetPath.startsWith("/payroll-advance/") || targetPath.startsWith("/payroll-adjustments/") || targetPath.startsWith("/bank-transactions/")))
  || (role === "warehouse" && (targetPath.startsWith("/inventory/") || targetPath.startsWith("/fixed-assets/") || targetPath.startsWith("/meal-schedule/")))
  || (role === "technologist" && /^\/meals\/\d+$/.test(targetPath));