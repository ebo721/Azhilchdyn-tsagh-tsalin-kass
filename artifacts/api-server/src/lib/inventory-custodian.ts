import { eq } from "drizzle-orm";
import { usersTable } from "@workspace/db";
import type { Tx } from "./route-shared.js";

export class InventoryCustodianError extends Error {}
type Assignment = { responsibleUserId: number | null; responsibleName: string | null };

/** Store a document-time name; later account edits/deletions must not rewrite history. */
export async function inventoryCustodian(tx: Tx, id: number | null | undefined, existing?: Assignment): Promise<Assignment> {
  if (id === undefined) return existing ?? { responsibleUserId: null, responsibleName: null };
  if (existing && id === existing.responsibleUserId) return existing;
  if (id === null) return { responsibleUserId: null, responsibleName: null };
  const [user] = await tx.select({ id: usersTable.id, role: usersTable.role, name: usersTable.fullName })
    .from(usersTable).where(eq(usersTable.id, id)).for("share");
  if (!user || user.role !== "warehouse" || !user.name?.trim()) {
    throw new InventoryCustodianError("Тохиргоонд нэр нь бүртгэлтэй нярав сонгоно уу");
  }
  return { responsibleUserId: user.id, responsibleName: user.name };
}
