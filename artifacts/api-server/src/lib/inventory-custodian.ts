import { and, eq } from "drizzle-orm";
import { employeesTable, inventoryCustodianEmployeesTable, usersTable } from "@workspace/db";
import type { Tx } from "./route-shared.js";

export class InventoryCustodianError extends Error {}
type Assignment = { responsibleUserId: number | null; responsibleEmployeeId: number | null; responsibleName: string | null };

/** Store a document-time name; later account edits/deletions must not rewrite history. */
export async function inventoryCustodian(tx: Tx, id: number | null | undefined, existing?: Assignment, employeeId?: number | null): Promise<Assignment> {
  if (employeeId !== undefined) {
    if (employeeId === existing?.responsibleEmployeeId && existing?.responsibleName) return existing;
    if (employeeId === null) return { responsibleUserId: null, responsibleEmployeeId: null, responsibleName: null };
    const [employee] = await tx.select({ id: employeesTable.id, name: employeesTable.name })
      .from(inventoryCustodianEmployeesTable)
      .innerJoin(employeesTable, eq(employeesTable.id, inventoryCustodianEmployeesTable.employeeId))
      .innerJoin(usersTable, eq(usersTable.id, inventoryCustodianEmployeesTable.userId))
      .where(and(eq(employeesTable.id, employeeId), eq(usersTable.role, "warehouse"))).limit(1).for("share");
    if (!employee || !employee.name.trim()) throw new InventoryCustodianError("Тохиргоонд ажилчдын жагсаалтаас сонгосон нярав сонгоно уу");
    return { responsibleUserId: null, responsibleEmployeeId: employee.id, responsibleName: employee.name };
  }
  if (id === undefined) return existing ?? { responsibleUserId: null, responsibleEmployeeId: null, responsibleName: null };
  if (existing && id === existing.responsibleUserId) return existing;
  if (id === null) return { responsibleUserId: null, responsibleEmployeeId: null, responsibleName: null };
  throw new InventoryCustodianError("Няравыг ажилчдын жагсаалтаас сонгоно уу");
}
