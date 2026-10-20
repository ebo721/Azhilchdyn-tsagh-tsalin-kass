import { and, eq, inArray, or, sql } from "drizzle-orm";
import { bankAccountsTable, bankInternalTransfersTable, bankTransactionsTable, db } from "@workspace/db";
import type { Tx } from "./route-shared.js";

type BankRow = typeof bankTransactionsTable.$inferSelect;
export const internalTransferMessage = "Дотоод шилжүүлгээр хосолсон гүйлгээ байна. Эхлээд хосыг салгана уу.";
export class InternalTransferError extends Error {
  status = 409;
  constructor(message = internalTransferMessage) { super(message); }
}
export const notInternalTransfer = sql`NOT EXISTS (
  SELECT 1 FROM bank_internal_transfers bit
  WHERE bit.out_bank_transaction_id = ${bankTransactionsTable.id}
     OR bit.in_bank_transaction_id = ${bankTransactionsTable.id}
)`;
export async function transferFor(tx: Pick<Tx, "select">, id: number) {
  const [pair] = await tx.select().from(bankInternalTransfersTable).where(or(
    eq(bankInternalTransfersTable.outBankTransactionId, id),
    eq(bankInternalTransfersTable.inBankTransactionId, id),
  ));
  return pair ?? null;
}
/** Call while holding the bank row lock, so pairing and accounting serialize. */
export async function assertNotInternalTransfer(tx: Pick<Tx, "select">, id: number) {
  if (await transferFor(tx, id)) throw new InternalTransferError();
}
export function transferRule(a: BankRow, b: BankRow, pairedIds: ReadonlySet<number> = new Set()) {
  const out = a.type === "expense" ? a : b;
  const incoming = a.type === "income" ? a : b;
  if (a.id === b.id || out.type !== "expense" || incoming.type !== "income"
    || a.bankAccountId === null || b.bankAccountId === null || a.bankAccountId === b.bankAccountId
    || [a, b].some(row => row.cashTransactionId !== null || row.transferredAt !== null
      || row.journalEntryId !== null || row.unclearAt !== null || pairedIds.has(row.id))
    || !Number.isFinite(a.transactionAt.getTime()) || !Number.isFinite(b.transactionAt.getTime())
    || Math.abs(a.transactionAt.getTime() - b.transactionAt.getTime()) > 2 * 86400000) return null;
  const outCents = Math.round(Number(out.amount) * 100), inCents = Math.round(Number(incoming.amount) * 100);
  const fee = outCents - inCents;
  if (!Number.isSafeInteger(outCents) || !Number.isSafeInteger(inCents)
    || outCents <= 0 || inCents <= 0 || fee < 0 || fee * 100 > outCents) return null;
  return { out, incoming, feeAmount: fee / 100 };
}
export function transferScore(a: BankRow, b: BankRow, accounts: Array<{ id: number; accountNumber: string; bankName: string }>) {
  const text = `${a.description} ${a.counterparty}`.normalize("NFKC").toLocaleLowerCase("mn-MN");
  const reverse = `${b.description} ${b.counterparty}`.normalize("NFKC").toLocaleLowerCase("mn-MN");
  const mentions = (haystack: string, accountId: number | null) => {
    const account = accounts.find(row => row.id === accountId);
    return account && [account.accountNumber, account.bankName].some(value => value.trim()
      && haystack.includes(value.normalize("NFKC").toLocaleLowerCase("mn-MN")));
  };
  return (Math.round(Number(a.amount) * 100) === Math.round(Number(b.amount) * 100) ? 50 : 0)
    + (a.transactionAt.toISOString().slice(0, 10) === b.transactionAt.toISOString().slice(0, 10) ? 25 : 0)
    + (mentions(text, b.bankAccountId) || mentions(reverse, a.bankAccountId) ? 25 : 0);
}
export async function transferSuggestions(id: number) {
  const [bank] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
  if (!bank) return null;
  if (await transferFor(db, id)) return [];
  const [rows, accounts] = await Promise.all([
    db.select().from(bankTransactionsTable).where(and(notInternalTransfer,
      sql`${bankTransactionsTable.transactionAt} BETWEEN ${new Date(bank.transactionAt.getTime() - 2 * 86400000)} AND ${new Date(bank.transactionAt.getTime() + 2 * 86400000)}`)),
    db.select().from(bankAccountsTable),
  ]);
  return rows.flatMap(peer => {
    const valid = transferRule(bank, peer);
    if (!valid) return [];
    const account = accounts.find(row => row.id === peer.bankAccountId);
    return [{ id: peer.id, transactionAt: peer.transactionAt.toISOString(), amount: Number(peer.amount),
      description: peer.description, bankAccountId: peer.bankAccountId!, bankName: account?.bankName ?? "",
      bankAccountNumber: account?.accountNumber ?? "", score: transferScore(bank, peer, accounts), feeAmount: valid.feeAmount }];
  }).sort((a, b) => b.score - a.score || a.id - b.id);
}
/** One indexed bulk query, rather than one database round-trip per imported row. */
export async function countTransferSuggestions(ids: number[]) {
  if (!ids.length) return 0;
  const result = await db.execute(sql`
    SELECT count(*)::integer AS count FROM bank_transactions b
    WHERE b.id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
      AND b.cash_transaction_id IS NULL AND b.transferred_at IS NULL
      AND b.journal_entry_id IS NULL AND b.unclear_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM bank_internal_transfers t
        WHERE t.out_bank_transaction_id = b.id OR t.in_bank_transaction_id = b.id)
      AND EXISTS (
        SELECT 1 FROM bank_transactions p
        WHERE p.bank_account_id <> b.bank_account_id
          AND ((b.type = 'expense' AND p.type = 'income'
            AND p.amount <= b.amount AND p.amount >= b.amount * 0.99)
          OR (b.type = 'income' AND p.type = 'expense'
            AND b.amount <= p.amount AND b.amount >= p.amount * 0.99))
          AND b.amount > 0 AND p.amount > 0
          AND p.transaction_at BETWEEN b.transaction_at - interval '2 days' AND b.transaction_at + interval '2 days'
          AND p.cash_transaction_id IS NULL AND p.transferred_at IS NULL
          AND p.journal_entry_id IS NULL AND p.unclear_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM bank_internal_transfers t
            WHERE t.out_bank_transaction_id = p.id OR t.in_bank_transaction_id = p.id)
      )`);
  return Number(result.rows[0]?.count ?? 0);
}
export async function pairTransfer(id: number, peerId: number, createdBy: number) {
  if (id === peerId) throw new InternalTransferError("Өөр гүйлгээ сонгоно уу.");
  return db.transaction(async tx => {
    // Deterministic bank-row locks also protect the cross-column membership rule.
    const rows = await tx.select().from(bankTransactionsTable).where(inArray(bankTransactionsTable.id, [id, peerId]))
      .orderBy(bankTransactionsTable.id).for("update");
    if (rows.length !== 2) return null;
    const pairs = await tx.select().from(bankInternalTransfersTable).where(or(
      inArray(bankInternalTransfersTable.outBankTransactionId, [id, peerId]),
      inArray(bankInternalTransfersTable.inBankTransactionId, [id, peerId])));
    if (pairs.length === 1 && [pairs[0].outBankTransactionId, pairs[0].inBankTransactionId].includes(id)
      && [pairs[0].outBankTransactionId, pairs[0].inBankTransactionId].includes(peerId)) return pairs[0];
    const valid = transferRule(rows[0], rows[1], new Set(pairs.flatMap(p => [p.outBankTransactionId, p.inBankTransactionId])));
    if (!valid) throw new InternalTransferError("Эдгээр гүйлгээг дотоод шилжүүлгээр хослох боломжгүй.");
    // Phase 1: all banks share 1010; internal transfers net to zero. No journal or fee expense.
    const [pair] = await tx.insert(bankInternalTransfersTable).values({
      outBankTransactionId: valid.out.id, inBankTransactionId: valid.incoming.id,
      feeAmount: valid.feeAmount, createdBy,
    }).returning();
    return pair;
  });
}
export async function unpairTransfer(id: number) {
  const ref = await transferFor(db, id);
  if (!ref) return;
  await db.transaction(async tx => {
    await tx.select().from(bankTransactionsTable).where(inArray(bankTransactionsTable.id,
      [ref.outBankTransactionId, ref.inBankTransactionId])).orderBy(bankTransactionsTable.id).for("update");
    // Never delete a newer pair created while this request was waiting.
    await tx.delete(bankInternalTransfersTable).where(eq(bankInternalTransfersTable.id, ref.id));
  });
}
