/** One menu catalog for navigation, account forms and server restrictions. */
export const STAFF_MENUS = [
  { path: "/", label: "Статистик" },
  { path: "/employees", label: "Ажилчид" },
  { path: "/attendance", label: "Ирц" },
  { path: "/attendance/devices", label: "Ирцийн төхөөрөмж" },
  { path: "/hour-balance", label: "Цагийн баланс" },
  { path: "/payroll", label: "Цалин" },
  { path: "/cash", label: "Касс" },
  { path: "/bank-transactions", label: "Банкны гүйлгээ" },
  { path: "/operating-expenses", label: "Үйл ажиллагааны зардал" },
  { path: "/inventory", label: "Бараа материал" },
  { path: "/meals", label: "Хоолны цэс" },
  { path: "/meal-schedule", label: "Хоолны хуваарь" },
  { path: "/meal-counts", label: "Хоолны тоо" },
  { path: "/fixed-assets", label: "Эд хөрөнгө" },
  { path: "/journal", label: "Ерөнхий журнал" },
  { path: "/ar-ap", label: "Авлага, Өглөг" },
  { path: "/deletion-requests", label: "Устгах хүсэлт" },
  { path: "/users", label: "Хэрэглэгчийн тохиргоо" },
] as const;

export type StaffMenuPath = typeof STAFF_MENUS[number]["path"];
export const ROLE_MENU_PATHS = {
  admin: STAFF_MENUS.map(menu => menu.path),
  hr: ["/employees", "/attendance", "/attendance/devices", "/hour-balance", "/meal-counts"],
  accountant: ["/employees", "/hour-balance", "/payroll", "/cash", "/bank-transactions", "/operating-expenses", "/journal", "/ar-ap", "/meal-counts"],
  warehouse: ["/inventory", "/fixed-assets", "/operating-expenses", "/meals", "/meal-schedule", "/meal-counts"],
  viewer: ["/employees", "/attendance", "/hour-balance", "/payroll", "/cash", "/bank-transactions", "/operating-expenses", "/inventory", "/fixed-assets", "/journal", "/ar-ap", "/meals", "/meal-schedule", "/meal-counts"],
  technologist: ["/meals", "/meal-schedule", "/meal-counts"],
} satisfies Record<string, readonly StaffMenuPath[]>;
export type MenuStaffRole = keyof typeof ROLE_MENU_PATHS;

export function defaultMenuPaths(role: MenuStaffRole): StaffMenuPath[] {
  // Preserve the existing warehouse sidebar, including its absent expenses link.
  return ROLE_MENU_PATHS[role].filter(path => role !== "warehouse" || path !== "/operating-expenses");
}

export function accessibleMenuPaths(role: MenuStaffRole, selected?: readonly string[] | null): StaffMenuPath[] {
  const ceiling: readonly StaffMenuPath[] = ROLE_MENU_PATHS[role];
  return selected == null ? [...ceiling] : ceiling.filter(path => selected.includes(path));
}

export function visibleMenuPaths(role: MenuStaffRole, selected?: readonly string[] | null): StaffMenuPath[] {
  return selected == null ? defaultMenuPaths(role) : accessibleMenuPaths(role, selected);
}

export function validMenuSelection(role: MenuStaffRole, selected: unknown): selected is string[] | null {
  if (selected === null) return true;
  return Array.isArray(selected) && selected.length <= STAFF_MENUS.length
    && new Set(selected).size === selected.length
    && selected.every(path => typeof path === "string" && (ROLE_MENU_PATHS[role] as readonly string[]).includes(path))
    && (role !== "admin" || selected.includes("/users"));
}

export function menuForPage(path: string): StaffMenuPath | undefined {
  const clean = path.replace(/\/+$/, "") || "/";
  return [...STAFF_MENUS].reverse().find(menu =>
    clean === menu.path || (menu.path !== "/" && clean.startsWith(`${menu.path}/`)))?.path;
}
