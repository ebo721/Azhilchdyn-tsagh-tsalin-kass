import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { asc, eq, sql } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";
import type { EmployeeInsuranceImportChoice, EmployeeInsuranceImportRow, SocialInsuranceProfile } from "@workspace/api-zod";
import { EmployeeImportError, type InsuranceImportSource } from "./employee-insurance-xlsx.js";

type Employee = typeof employeesTable.$inferSelect;
const normalized = (text = "") => text.normalize("NFKC").toLowerCase().replace(/[\s.\-_'’]/g, "");
const registration = (text = "") => text.replace(/\s/g, "").toUpperCase();
const profileDefaults: SocialInsuranceProfile = { givenName: "", registrationNumber: "", clanName: "", parentName: "",
  insuranceTypeCode: "", occupationCode: "", citizenship: "", email: "" };
function matchesName(row: InsuranceImportSource, employee: Employee) {
  const parts = employee.name.trim().split(/[.\s]+/).filter(Boolean);
  const given = employee.socialInsuranceProfile?.givenName || (parts.length > 1 ? parts.slice(1).join(" ") : employee.name);
  if (normalized(row.name) !== normalized(given) && normalized(row.name) !== normalized(employee.name)) return false;
  const parent = employee.socialInsuranceProfile?.parentName;
  if (parent && row.profile.parentName) return normalized(parent) === normalized(row.profile.parentName);
  if (parts.length > 1 && row.profile.parentName) return normalized(parts[0]).length === 1
    ? normalized(row.profile.parentName).startsWith(normalized(parts[0]))
    : normalized(parts[0]) === normalized(row.profile.parentName);
  return true;
}
export function previewInsuranceRows(rows: InsuranceImportSource[], employees: Employee[]): EmployeeInsuranceImportRow[] {
  return rows.map(row => {
    const byRegistration = row.profile.registrationNumber
      ? employees.filter(e => registration(e.socialInsuranceProfile?.registrationNumber) === row.profile.registrationNumber) : [];
    const byName = employees.filter(employee => matchesName(row, employee));
    // A registration match helps identify candidates, but duplicate names still
    // require the user's choice rather than silently selecting one person.
    const candidates = byRegistration.length
      ? [...new Map([...byRegistration, ...(byName.length > 1 ? byName : [])].map(e => [e.id, e])).values()]
      : byName;
    const issues = [...row.issues];
    let status: EmployeeInsuranceImportRow["status"] = candidates.length === 1 ? "matched" : candidates.length ? "ambiguous" : "unmatched";
    const target = candidates[0];
    if (row.issues.length) status = "invalid";
    else if (target && candidates.length === 1 && (
      (byRegistration.length && !matchesName(row, target))
      || (target.socialInsuranceProfile?.registrationNumber && row.profile.registrationNumber
        && registration(target.socialInsuranceProfile.registrationNumber) !== row.profile.registrationNumber)
      || (target.socialInsuranceProfile?.parentName && row.profile.parentName
        && normalized(target.socialInsuranceProfile.parentName) !== normalized(row.profile.parentName))
    )) {
      status = "conflict";
      issues.push("Хадгалсан нэр/овог эсвэл регистр зөрүүтэй. Ажилтныг нягталж сонгоно уу.");
    }
    if (status === "ambiguous") issues.push("Ижил мэдээлэлтэй олон ажилтан байна. Аль ажилтан болохыг сонгоно уу.");
    if (status === "unmatched") issues.push("Тохирох ажилтан олдсонгүй. Бүртгэлээс сонгох эсвэл алгасана уу.");
    return { ...row, status, issues, suggestedEmployeeId: status === "matched" ? target.id : null,
      candidates: candidates.map(e => ({ employeeId: e.id, name: e.name, parentName: e.socialInsuranceProfile?.parentName ?? "",
        registrationNumber: e.socialInsuranceProfile?.registrationNumber ?? "", role: e.role, status: e.status })) };
  });
}
export function employeeRosterHash(employees: Employee[]) {
  return createHash("sha256").update(JSON.stringify([...employees].sort((a,b)=>a.id-b.id).map(e => ({
    id: e.id, name: e.name, phone: e.phone, profile: e.socialInsuranceProfile,
  })))).digest("hex");
}
type ImportToken = { actor: number; expires: number; rosterHash: string; rows: InsuranceImportSource[] };
function signature(body: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required");
  return createHmac("sha256", secret).update(`employee-insurance-import:${body}`).digest("base64url");
}
export function createEmployeeImportToken(rows: InsuranceImportSource[], employees: Employee[], actor: number) {
  const payload: ImportToken = { actor, expires: Date.now() + 20 * 60 * 1000, rosterHash: employeeRosterHash(employees), rows };
  const body = gzipSync(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signature(body)}`;
}
export function readEmployeeImportToken(token: string, actor: number): ImportToken {
  try {
    const [body, mac, extra] = token.split(".");
    if (!body || !mac || extra || token.length > 1_000_000) throw new Error();
    const expected = Buffer.from(signature(body));
    const actual = Buffer.from(mac);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const data: ImportToken = JSON.parse(gunzipSync(Buffer.from(body, "base64url"), { maxOutputLength: 4 * 1024 * 1024 }).toString("utf8"));
    if (data.actor !== actor || data.expires <= Date.now() || !Array.isArray(data.rows)) throw new Error();
    return data;
  } catch { throw new EmployeeImportError("Уншуулалтын баталгаажуулалт хүчингүй эсвэл хугацаа дууссан. Файлыг дахин уншуулна уу."); }
}
export function planEmployeeInsuranceUpdates(rows: InsuranceImportSource[], selections: EmployeeInsuranceImportChoice[], employees: Employee[]) {
  if (selections.length !== rows.length || new Set(selections.map(s=>s.rowNumber)).size !== selections.length
    || selections.some(choice => !rows.some(row => row.rowNumber === choice.rowNumber))) {
    throw new EmployeeImportError("Мөр бүрт ажилтан сонгох эсвэл алгасах шийдвэр оруулна уу.", 409);
  }
  const selectedIds = new Set<number>();
  const updates: Array<{ employeeId: number; phone: string; socialInsuranceProfile: SocialInsuranceProfile }> = [];
  let skipped = 0, unchanged = 0;
  const finalProfiles = new Map(employees.map(e => [e.id, e.socialInsuranceProfile]));
  for (const row of rows) {
    const choice = selections.find(s => s.rowNumber === row.rowNumber)!;
    if (choice.employeeId === null) { skipped++; continue; }
    if (row.issues.length) throw new EmployeeImportError(`${row.rowNumber}-р мөрийн алдааг эх файлд засах эсвэл алгасана уу.`, 409);
    if (selectedIds.has(choice.employeeId)) throw new EmployeeImportError("Нэг ажилтанд олон мөр оноосон байна. Сонголтоо шалгана уу.", 409);
    selectedIds.add(choice.employeeId);
    const employee = employees.find(e => e.id === choice.employeeId);
    if (!employee) throw new EmployeeImportError("Сонгосон ажилтан байхгүй болсон. Файлыг дахин уншуулна уу.", 409);
    const profile = { ...profileDefaults, ...employee.socialInsuranceProfile };
    for (const key of Object.keys(profileDefaults) as Array<keyof SocialInsuranceProfile>) {
      const value = row.profile[key]?.trim();
      if (value) profile[key] = value;
    }
    const phone = row.phone || employee.phone;
    finalProfiles.set(employee.id, profile);
    if (JSON.stringify(profile) === JSON.stringify({ ...profileDefaults, ...employee.socialInsuranceProfile }) && phone === employee.phone) unchanged++;
    else updates.push({ employeeId: employee.id, phone, socialInsuranceProfile: profile });
  }
  for (const id of selectedIds) {
    const reg = registration(finalProfiles.get(id)?.registrationNumber);
    if (reg && [...finalProfiles].some(([otherId, profile]) => otherId !== id && registration(profile?.registrationNumber) === reg)) {
      throw new EmployeeImportError("Регистр өөр ажилтанд давхардаж байна. Сонгосон ажилтнуудыг нягтална уу.", 409);
    }
  }
  return { updates, skipped, unchanged };
}
export async function applyEmployeeInsuranceImport(token: string, selections: EmployeeInsuranceImportChoice[], actor: number) {
  const preview = readEmployeeImportToken(token, actor);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20260919)`);
    await tx.execute(sql`LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE`);
    const employees = await tx.select().from(employeesTable).orderBy(asc(employeesTable.id));
    if (employeeRosterHash(employees) !== preview.rosterHash) throw new EmployeeImportError("Урьдчилж шалгаснаас хойш ажилтны мэдээлэл өөрчлөгдсөн. Файлыг дахин уншуулж нягтална уу.", 409);
    const plan = planEmployeeInsuranceUpdates(preview.rows, selections, employees);
    for (const update of plan.updates) {
      await tx.update(employeesTable).set({ phone: update.phone, socialInsuranceProfile: update.socialInsuranceProfile })
        .where(eq(employeesTable.id, update.employeeId));
    }
    return { updated: plan.updates.length, skipped: plan.skipped, unchanged: plan.unchanged };
  });
}
