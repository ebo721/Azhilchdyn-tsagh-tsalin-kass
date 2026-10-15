import { accessibleMenuPaths, type MenuStaffRole, type StaffMenuPath } from "@workspace/api-zod";

/** Bank settlement may read source lists, but not source details or mutations. */
export function bankDocumentLookupMenu(path: string, method: string): StaffMenuPath | undefined {
  if (method !== "GET") return undefined;
  const p = path.toLowerCase().replace(/\/+$/, "");
  if (p === "/inventory/purchases") return "/inventory";
  if (p === "/operating-expenses") return "/operating-expenses";
  if (p === "/fixed-assets") return "/fixed-assets";
  return undefined;
}

/** Read-only dependencies keep a chosen page usable; they never grant mutations. */
function requiredMenus(path: string, method: string): StaffMenuPath[] {
  const p = path.toLowerCase().replace(/\/+$/, "") || "/";
  const starts = (prefix: string) => p === prefix || p.startsWith(`${prefix}/`);
  const read = method === "GET";
  if (starts("/dashboard")) return ["/"];
  if (starts("/attendance/devices")) return ["/attendance/devices"];
  if (read && ["/attendance/shifts", "/attendance/shift-plans"].some(starts)) return ["/attendance", "/hour-balance", "/payroll"];
  if (starts("/attendance")) return ["/attendance"];
  if (p === "/employees" && read) return ["/employees", "/attendance", "/cash", "/payroll", "/users", "/ar-ap", "/bank-transactions"];
  if (read && /^\/employees\/\d+\/salary-bank-account$/.test(p)) return ["/employees", "/cash", "/payroll", "/bank-transactions"];
  if (starts("/employees")) return ["/employees"];
  if (starts("/hour-balance")) return ["/hour-balance"];
  if (starts("/payroll") || starts("/payroll-advance") || starts("/payroll-schedule") || starts("/payroll-adjustments")) return ["/payroll"];
  if (read && p === "/cash/closures") return ["/cash", "/payroll", "/operating-expenses", "/inventory", "/fixed-assets"];
  if (starts("/cash")) return ["/cash"];
  if (starts("/bank-accounts")) return read ? ["/bank-transactions", "/cash", "/journal", "/ar-ap"] : ["/bank-transactions"];
  if (starts("/bank-transactions")) return ["/bank-transactions"];
  const documentMenu = bankDocumentLookupMenu(p, method);
  if (documentMenu) return [documentMenu, "/bank-transactions"];
  if (read && p === "/inventory/items") return ["/inventory", "/meals", "/meal-schedule"];
  if (starts("/inventory/material-requests")) return ["/inventory", "/meals", "/meal-schedule"];
  if (starts("/inventory")) return ["/inventory"];
  if (starts("/fixed-assets")) return ["/fixed-assets"];
  if (starts("/operating-expenses")) return ["/operating-expenses"];
  if (starts("/journal/receivables") || starts("/journal/payables")) return read
    ? ["/journal", "/ar-ap", "/payroll"] : ["/journal", "/ar-ap"];
  if (read && p === "/journal/suppliers") return ["/journal", "/bank-transactions"];
  if (starts("/journal")) return ["/journal"];
  if (starts("/meal-schedule")) return ["/meal-schedule"];
  if (starts("/meal-counts")) return ["/meal-counts"];
  if (starts("/meal-edit-requests")) return ["/meals"];
  if (starts("/meals")) return ["/meals"];
  if (starts("/deletion-requests")) return ["/deletion-requests"];
  if (starts("/unclear-transactions")) return ["/users"];
  if (starts("/chart-of-accounts")) return read
    ? ["/users", "/cash", "/bank-transactions", "/operating-expenses", "/inventory", "/fixed-assets", "/journal", "/ar-ap", "/payroll"]
    : ["/users"];
  return []; // Explicit assignments fail closed for unclassified endpoints.
}

export function canUseMenuApi(
  session: { role: MenuStaffRole; menuPaths?: string[] | null },
  path: string, method: string, deletionTarget?: unknown,
) {
  // NULL intentionally preserves all pre-existing role behavior for old accounts.
  if (session.menuPaths == null) return true;
  const allowed = accessibleMenuPaths(session.role, session.menuPaths);
  const normalized = path.toLowerCase().replace(/\/+$/, "");
  if (method === "POST" && normalized === "/deletion-requests" && typeof deletionTarget === "string") {
    return requiredMenus(deletionTarget.split("?")[0], "DELETE").some(menu => allowed.includes(menu));
  }
  return requiredMenus(path, method).some(menu => allowed.includes(menu));
}
