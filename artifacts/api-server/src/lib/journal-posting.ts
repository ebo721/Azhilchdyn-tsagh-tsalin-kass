import { chartOfAccountsTable, db, journalEntriesTable, journalLinesTable, receivablesTable, receivableAllocationsTable, employeesTable, inventorySuppliersTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class JournalValidationError extends Error {}
type ReceivableSettlementTestHook = (receivableId: number) => Promise<void>;
let receivableSettlementTestHook: ReceivableSettlementTestHook | undefined;
export function setReceivableSettlementTestHook(hook: ReceivableSettlementTestHook | undefined) {
  receivableSettlementTestHook = hook;
}

type JournalLineInput = {
  accountId: number;
  debit: number;
  credit: number;
  memo?: string | null;
  allocation?: ReceivableAllocationInput | null;
};
export type ReceivableAllocationInput =
  | { kind: "create"; partyType: "employee" | "supplier"; employeeId?: number; supplierId?: number }
  | { kind: "settle"; receivableId: number };
export type JournalEntryLineInput = JournalLineInput;

type PostJournalEntryInput = {
  journalEntryId?: number;
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

// Keep every transition into "posted" inside this module. Direct SQL must not
// create or promote posted entries because entry-level debit/credit balance
// cannot be expressed as a journal_lines row CHECK constraint.
async function postJournalEntryInternal(
  tx: Tx,
  input: PostJournalEntryInput,
  allowInactiveAccounts: boolean,
  allowReceivableReversal = false,
): Promise<{ journalEntryId: number; status: "draft" | "posted" }> {
  const { lines, status } = await validateAndNormalizeJournalLines(tx, input.lines, allowInactiveAccounts, allowReceivableReversal);

  let journalEntryId: number;
  if (input.journalEntryId === undefined) {
    const [entry] = await tx.insert(journalEntriesTable).values({
      date: input.date,
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      createdBy: input.createdBy,
      status,
    }).returning({ id: journalEntriesTable.id });
    journalEntryId = entry.id;
  } else {
    const [entry] = await tx.select({
      id: journalEntriesTable.id,
      status: journalEntriesTable.status,
    }).from(journalEntriesTable)
      .where(eq(journalEntriesTable.id, input.journalEntryId))
      .for("update");
    if (!entry) throw Object.assign(new Error("Journal entry not found"), { status: 404 });
    if (entry.status !== "draft") {
      throw Object.assign(new Error("Only draft journal entries can be updated"), { status: 409 });
    }
    journalEntryId = entry.id;
    await tx.delete(journalLinesTable).where(eq(journalLinesTable.journalEntryId, journalEntryId));
    await tx.update(journalEntriesTable).set({
      date: input.date,
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      createdBy: input.createdBy,
      status,
    }).where(eq(journalEntriesTable.id, journalEntryId));
  }

  const insertedLines = await tx.insert(journalLinesTable).values(lines.map((line) => ({
    journalEntryId,
    accountId: line.accountId,
    debit: line.debitCents / 100,
    credit: line.creditCents / 100,
    memo: line.memo ?? null,
    allocation: line.allocation ?? null,
  }))).returning({ id: journalLinesTable.id });

  if (status === "posted") {
    for (let index = 0; index < lines.length; index += 1) {
      await applyReceivableEffect(tx, journalEntryId, insertedLines[index].id, lines[index]);
    }
  }

  return { journalEntryId, status };
}

export async function validateAndNormalizeJournalLines(
  tx: Tx,
  inputLines: JournalLineInput[],
  allowInactiveAccounts = false,
  allowReceivableReversal = false,
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
  const receivableAccount = (await tx.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable)
    .where(eq(chartOfAccountsTable.code, "1200")).limit(1))[0]?.id;
  for (const line of lines) {
    if (receivableAccount !== undefined && line.accountId === receivableAccount) {
      const allocation = line.allocation;
      if (!allocation && !allowReceivableReversal) throw new JournalValidationError("Account 1200 requires receivable allocation metadata");
      if (!allocation) continue;
      if (line.debitCents > 0 && (allocation.kind !== "create" || (allocation.partyType === "employee" ? !allocation.employeeId || allocation.supplierId : !allocation.supplierId || allocation.employeeId))) {
        throw new JournalValidationError("Receivable debit must select exactly one employee or supplier");
      }
      if (line.creditCents > 0 && allocation.kind !== "settle") {
        throw new JournalValidationError("Receivable credit must select an existing receivable");
      }
    } else if (line.allocation) {
      throw new JournalValidationError("Receivable allocation is only valid for account 1200");
    }
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

async function applyReceivableEffect(tx: Tx, entryId: number, lineId: number, line: JournalLineInput & { debitCents: number; creditCents: number }) {
  if (!line.allocation) return;
  if (line.allocation.kind === "create") {
    if (line.allocation.partyType === "employee") {
      const [employee] = await tx.select({ id: employeesTable.id }).from(employeesTable)
        .where(and(eq(employeesTable.id, line.allocation.employeeId!), eq(employeesTable.status, "active")));
      if (!employee) throw new JournalValidationError("Employee not found or inactive");
    } else {
      const [supplier] = await tx.select({ id: inventorySuppliersTable.id }).from(inventorySuppliersTable)
        .where(eq(inventorySuppliersTable.id, line.allocation.supplierId!));
      if (!supplier) throw new JournalValidationError("Supplier not found");
    }
    await tx.insert(receivablesTable).values({
      originJournalEntryId: entryId, originJournalLineId: lineId,
      employeeId: line.allocation.partyType === "employee" ? line.allocation.employeeId! : null,
      supplierId: line.allocation.partyType === "supplier" ? line.allocation.supplierId! : null,
      originalAmount: line.debitCents / 100, openAmount: line.debitCents / 100, status: "open",
    });
    return;
  }
  const [receivable] = await tx.select().from(receivablesTable)
    .where(eq(receivablesTable.id, line.allocation.receivableId)).for("update");
  if (!receivable) throw Object.assign(new Error("Receivable not found"), { status: 404 });
  if (process.env.RECEIVABLE_TEST_HOOK === "1" && receivableSettlementTestHook) {
    await receivableSettlementTestHook(receivable.id);
  }
  const amount = line.creditCents / 100;
  if (receivable.status !== "open" || Number(receivable.openAmount) < amount) throw Object.assign(new Error("Settlement exceeds open receivable balance"), { status: 409 });
  const openAmount = Math.round((Number(receivable.openAmount) - amount) * 100) / 100;
  await tx.insert(receivableAllocationsTable).values({
    receivableId: receivable.id, settlementJournalEntryId: entryId, settlementJournalLineId: lineId, amount,
  });
  await tx.update(receivablesTable).set({ openAmount, status: openAmount === 0 ? "settled" : "open" }).where(eq(receivablesTable.id, receivable.id));
}

async function reverseReceivableEffects(tx: Tx, entryId: number) {
  const lines = await tx.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, entryId));
  for (const line of lines) {
    const allocation = line.allocation as ReceivableAllocationInput | null;
    if (!allocation) continue;
    if (allocation.kind === "create") {
      const [receivable] = await tx.select().from(receivablesTable).where(eq(receivablesTable.originJournalLineId, line.id)).for("update");
      if (receivable) {
        const [allocationRow] = await tx.select({ id: receivableAllocationsTable.id }).from(receivableAllocationsTable).where(eq(receivableAllocationsTable.receivableId, receivable.id)).limit(1);
        if (allocationRow) throw Object.assign(new Error("Cannot void receivable with existing settlements"), { status: 409 });
        await tx.delete(receivablesTable).where(eq(receivablesTable.id, receivable.id));
      }
    } else {
      const [row] = await tx.select().from(receivableAllocationsTable).where(eq(receivableAllocationsTable.settlementJournalLineId, line.id)).for("update");
      if (row) {
        const [receivable] = await tx.select().from(receivablesTable).where(eq(receivablesTable.id, row.receivableId)).for("update");
        if (receivable) {
          const openAmount = Math.round((Number(receivable.openAmount) + Number(row.amount)) * 100) / 100;
          await tx.update(receivablesTable).set({ openAmount, status: "open" }).where(eq(receivablesTable.id, receivable.id));
        }
        await tx.delete(receivableAllocationsTable).where(eq(receivableAllocationsTable.id, row.id));
      }
    }
  }
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

  await reverseReceivableEffects(tx, entry.id);

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
  }, true, true);
  if (reversal.status !== "posted") throw new Error("Journal reversal must be balanced");

  await tx.update(journalEntriesTable).set({
    status: "void",
    voidedAt: new Date(),
    voidedBy: input.voidedBy,
  }).where(eq(journalEntriesTable.id, entry.id));

  return { reversalEntryId: reversal.journalEntryId };
}