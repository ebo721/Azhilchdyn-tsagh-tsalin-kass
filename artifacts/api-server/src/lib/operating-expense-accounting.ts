import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type ExpenseAccountingStatus = "missing_both" | "missing_journal" | "missing_cash" | "complete";

/** Read actual entries, including legacy source links; never infer posting from paymentDate. */
export async function operatingExpenseAccountingStatuses(ids: number[]) {
  if (!ids.length) return new Map<number, ExpenseAccountingStatus>();
  const result = await db.execute(sql`
    SELECT e.id, cardinality(linked.ids) > 0 AS has_cash,
      EXISTS (
        SELECT 1 FROM journal_entries j WHERE j.status = 'posted' AND (
          j.id = b.journal_entry_id
          OR j.id IN (SELECT cc.journal_entry_id FROM cash_transactions cc WHERE cc.id = ANY(linked.ids))
          OR (j.source_type = 'cash' AND j.source_id = ANY(linked.ids))
          OR (j.source_type IN ('bank_transaction', 'bank') AND j.source_id = e.bank_transaction_id)
          OR (j.source_type = 'operating_expense' AND j.source_id = e.id)
        )
      ) AS has_journal
    FROM operating_expenses e
    LEFT JOIN bank_transactions b ON b.id = e.bank_transaction_id
    CROSS JOIN LATERAL (
      SELECT coalesce(array_agg(c.id), ARRAY[]::integer[]) AS ids
      FROM cash_transactions c WHERE c.type = 'expense' AND (
        c.id = e.cash_transaction_id OR c.id = b.cash_transaction_id
        OR c.bank_transaction_id = e.bank_transaction_id
        OR (c.source_type = 'operating_expense' AND c.source_key = 'expense:' || e.id::text)
      )
    ) linked
    WHERE e.id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
  `);
  return new Map(result.rows.map(row => [
    Number(row.id),
    row.has_cash ? (row.has_journal ? "complete" : "missing_journal")
      : (row.has_journal ? "missing_cash" : "missing_both"),
  ] as [number, ExpenseAccountingStatus]));
}
