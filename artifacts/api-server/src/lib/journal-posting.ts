import { chartOfAccountsTable, db, journalEntriesTable, journalLinesTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class JournalValidationError extends Error {}

type JournalLineInput = {
  accountId: number;
  debit: number;
  credit: number;
  memo?: string | null;
};
export type JournalEntryLineInput = JournalLineInput;

type PostJournalEntryInput = {
  date: string;
  description: string;
  sourceType: string;
  sourceId: number | null;
  createdBy: number | null;
  lines: JournalLineInput[];
};

export async function postJournalEntry(
  tx: Tx,
  input: PostJournalEntryInput,
): Promise<{ journalEntryId: number; status: "draft" | "posted" }> {
  return postJournalEntryInternal(tx, input, false);
}

async function postJournalEntryInternal(
  tx: Tx,
  input: PostJournalEntryInput,
  allowInactiveAccounts: boolean,
): Promise<{ journalEntryId: number; status: "draft" | "posted" }> {
  const { lines, status } = await validateAndNormalizeJournalLines(tx, input.lines, allowInactiveAccounts);

  const [entry] = await tx.insert(journalEntriesTable).values({
    date: input.date,
    description: input.description,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    createdBy: input.createdBy,
    status,
  }).returning({ id: journalEntriesTable.id });

  await tx.insert(journalLinesTable).values(lines.map((line) => ({
    journalEntryId: entry.id,
    accountId: line.accountId,
    debit: line.debitCents / 100,
    credit: line.creditCents / 100,
    memo: line.memo ?? null,
  })));

  return { journalEntryId: entry.id, status };
}

export async function validateAndNormalizeJournalLines(
  tx: Tx,
  inputLines: JournalLineInput[],
  allowInactiveAccounts = false,
) {
  if (inputLines.length < 2) throw new JournalValidationError("Journal entry must contain at least two lines");
  const lines = inputLines.map((line) => ({
    ...line,
    debitCents: Math.round(line.debit * 100),
    creditCents: Math.round(line.credit * 100),
  }));
  for (const line of lines) {
    const safeCents = Number.isSafeInteger(line.debitCents) && Number.isSafeInteger(line.creditCents);
    const debitOnly = safeCents && Number.isFinite(line.debit) && line.debitCents > 0 && line.creditCents === 0;
    const creditOnly = safeCents && Number.isFinite(line.credit) && line.creditCents > 0 && line.debitCents === 0;
    if (!debitOnly && !creditOnly) throw new JournalValidationError("Each journal line must contain either a debit or a credit");
  }
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const accounts = await tx.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable).where(
    allowInactiveAccounts ? inArray(chartOfAccountsTable.id, accountIds) : and(inArray(chartOfAccountsTable.id, accountIds), eq(chartOfAccountsTable.isActive, true)),
  );
  const validAccountIds = new Set(accounts.map((account) => account.id));
  if (accounts.length !== accountIds.length || accountIds.some((id) => !validAccountIds.has(id))) {
    throw new JournalValidationError("Every journal line must use an active account");
  }
  const debitCents = lines.reduce((sum, line) => sum + BigInt(line.debitCents), 0n);
  const creditCents = lines.reduce((sum, line) => sum + BigInt(line.creditCents), 0n);
  return { lines, status: debitCents === creditCents ? "posted" as const : "draft" as const };
}

export async function voidJournalEntry(
  tx: Tx,
  input: { journalEntryId: number; voidedBy: number | null },
): Promise<{ reversalEntryId: number }> {
  const [entry] = await tx
    .select()
    .from(journalEntriesTable)
    .where(eq(journalEntriesTable.id, input.journalEntryId))
    .for("update");
  if (!entry) throw new Error("Journal entry not found");
  if (entry.status !== "posted") throw new Error("Only a posted journal entry can be voided");

  const lines = await tx
    .select()
    .from(journalLinesTable)
    .where(eq(journalLinesTable.journalEntryId, entry.id));

  const reversal = await postJournalEntryInternal(tx, {
    date: entry.date,
    description: `Reversal: ${entry.description}`,
    sourceType: "reversal",
    sourceId: entry.id,
    createdBy: input.voidedBy,
    lines: lines.map((line) => ({
      accountId: line.accountId,
      debit: Number(line.credit),
      credit: Number(line.debit),
      memo: line.memo,
    })),
  }, true);
  if (reversal.status !== "posted") throw new Error("Journal reversal must be balanced");

  await tx.update(journalEntriesTable).set({
    status: "void",
    voidedAt: new Date(),
    voidedBy: input.voidedBy,
  }).where(eq(journalEntriesTable.id, entry.id));

  return { reversalEntryId: reversal.journalEntryId };
}