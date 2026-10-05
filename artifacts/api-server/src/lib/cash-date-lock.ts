import { sql } from "drizzle-orm";
import type { Tx } from "./route-shared.js";

/** Serialize cash-day closure with writes that can create or replace cash entries. */
export async function lockCashDate(tx: Tx, date: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cash-date:${date}`}))`);
}