import { chartOfAccountsTable, db, journalEntriesTable, journalLinesTable, receivablesTable, receivableAllocationsTable, payablesTable, payableAllocationsTable, employeesTable, inventorySuppliersTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class JournalValidationError extends Error {}
type ReceivableSettlementTestHook = (receivableId: number) => Promise<void>;
let receivableSettlementTestHook: ReceivableSettlementTestHook | undefined;
export function setReceivableSettlementTestHook(hook: ReceivableSettlementTestHook | undefined) {
  receivableSettlementTestHook = hook;
}
type PayableSettlementTestHook = (payableId: number) => Promise<void>;
let payableSettlementTestHook: PayableSettlementTestHook | undefined;
export function setPayableSettlementTestHook(hook: PayableSettlementTestHook | undefined) {
  payableSettlementTestHook = hook;
}

type JournalLineInput = {
  accountId: number;
  debit: number;
  credit: number;
  memo?: string | null;
  allocation?: ReceivableAllocationInput | PayableAllocationInput | null;
};
export type ReceivableAllocationInput =
  | { kind: "create"; partyType: "employee" | "supplier"; employeeId?: number; supplierId?: number }
  | { kind: "settle"; receivableId: number };
export type PayableAllocationInput =
  | Extract<ReceivableAllocationInput, { kind: "create" }>
  | { kind: "settle"; payableId: number };
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
  allowAllocationReversal = false,
): Promise<{ journalEntryId: number; status: "draft" | "posted" }> {
  const { lines, status, receivableAccount, payableAccount } = await validateAndNormalizeJournalLines(tx, input.lines, allowInactiveAccounts, allowAllocationReversal);

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
      if (lines[index].accountId === receivableAccount) {
        await applyReceivableEffect(tx, journalEntryId, insertedLines[index].id, lines[index]);
      } else if (lines[index].accountId === payableAccount) {
        await applyPayableEffect(tx, journalEntryId, insertedLines[index].id, lines[index], input.description);
      }
    }
  }

  return { journalEntryId, status };
}

export async function validateAndNormalizeJournalLines(
  tx: Tx,
  inputLines: JournalLineInput[],
  allowInactiveAccounts = false,
  allowAllocationReversal = false,
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
  const trackedAccounts = await tx.select({ id: chartOfAccountsTable.id, code: chartOfAccountsTable.code }).from(chartOfAccountsTable)
    .where(inArray(chartOfAccountsTable.code, ["1200", "2000"]));
  const receivableAccount = trackedAccounts.find((account) => account.code === "1200")?.id;
  const payableAccount = trackedAccounts.find((account) => account.code === "2000")?.id;
  for (const line of lines) {
    if (receivableAccount !== undefined && line.accountId === receivableAccount) {
      const allocation = line.allocation;
      if (!allocation && !allowAllocationReversal) throw new JournalValidationError("Account 1200 requires receivable allocation metadata");
      if (!allocation) continue;
      if (line.debitCents > 0 && (allocation.kind !== "create" || (allocation.partyType === "employee" ? !allocation.employeeId || allocation.supplierId : !allocation.supplierId || allocation.employeeId))) {
        throw new JournalValidationError("Receivable debit must select exactly one employee or supplier");
      }
      if (line.creditCents > 0 && (allocation.kind !== "settle" || !("receivableId" in allocation))) {
        throw new JournalValidationError("Receivable credit must select an existing receivable");
      }
    } else if (payableAccount !== undefined && line.accountId === payableAccount) {
      const allocation = line.allocation;
      if (!allocation && !allowAllocationReversal) throw new JournalValidationError("Account 2000 requires payable allocation metadata");
      if (!allocation) continue;
      if (line.creditCents > 0 && (allocation.kind !== "create" || (allocation.partyType === "employee" ? !allocation.employeeId || allocation.supplierId : !allocation.supplierId || allocation.employeeId))) {
        throw new JournalValidationError("Payable credit must select exactly one employee or supplier");
      }
      if (line.debitCents > 0 && (allocation.kind !== "settle" || !("payableId" in allocation))) {
        throw new JournalValidationError("Payable debit must select an existing payable");
      }
    } else if (line.allocation) {
      throw new JournalValidationError("Allocation is only valid for accounts 1200 and 2000");
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
  return { lines, receivableAccount, payableAccount, status: debitCents === creditCents ? "posted" as const : "draft" as const };
}

async function applyReceivableEffect(tx: Tx, entryId: number, lineId: number, line: JournalLineInput & { debitCents: number; creditCents: number }) {
  const allocation = line.allocation as ReceivableAllocationInput | null | undefined;
  if (!allocation) return;
  if (allocation.kind === "create") {
    if (allocation.partyType === "employee") {
      const [employee] = await tx.select({ id: employeesTable.id }).from(employeesTable)
        .where(and(eq(employeesTable.id, allocation.employeeId!), eq(employeesTable.status, "active")));
      if (!employee) throw new JournalValidationError("Employee not found or inactive");
    } else {
      const [supplier] = await tx.select({ id: inventorySuppliersTable.id }).from(inventorySuppliersTable)
        .where(eq(inventorySuppliersTable.id, allocation.supplierId!));
      if (!supplier) throw new JournalValidationError("Supplier not found");
    }
    await tx.insert(receivablesTable).values({
      originJournalEntryId: entryId, originJournalLineId: lineId,
      employeeId: allocation.partyType === "employee" ? allocation.employeeId! : null,
      supplierId: allocation.partyType === "supplier" ? allocation.supplierId! : null,
      originalAmount: line.debitCents / 100, openAmount: line.debitCents / 100, status: "open",
    });
    return;
  }
  const [receivable] = await tx.select().from(receivablesTable)
    .where(eq(receivablesTable.id, allocation.receivableId)).for("update");
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

async function applyPayableEffect(tx: Tx, entryId: number, lineId: number, line: JournalLineInput & { debitCents: number; creditCents: number }, description: string) {
  const allocation = line.allocation as PayableAllocationInput | null | undefined;
  if (!allocation) return;
  if (allocation.kind === "create") {
    const partyId = allocation.partyType === "employee" ? allocation.employeeId! : allocation.supplierId!;
    if (allocation.partyType === "employee") {
      const [employee] = await tx.select({ id: employeesTable.id }).from(employeesTable)
        .where(and(eq(employeesTable.id, partyId), eq(employeesTable.status, "active")));
      if (!employee) throw new JournalValidationError("Employee not found or inactive");
    } else {
      const [supplier] = await tx.select({ id: inventorySuppliersTable.id }).from(inventorySuppliersTable)
        .where(eq(inventorySuppliersTable.id, partyId));
      if (!supplier) throw new JournalValidationError("Supplier not found");
    }
    const [payable] = await tx.insert(payablesTable).values({
      partyType: allocation.partyType, partyId,
      originalAmount: line.creditCents / 100, remainingBalance: line.creditCents / 100,
      status: "open", journalEntryId: entryId, description: line.memo ?? description,
    }).returning({ id: payablesTable.id });
    // Schema A links origins by journal entry, not line. Persist the exact payable
    // ID on the journal line so voiding one entry with multiple parties is unambiguous.
    await tx.update(journalLinesTable).set({ allocation: { ...allocation, payableId: payable.id } })
      .where(eq(journalLinesTable.id, lineId));
    return;
  }
  const [payable] = await tx.select().from(payablesTable)
    .where(eq(payablesTable.id, allocation.payableId)).for("update");
  if (!payable) throw Object.assign(new Error("Payable not found"), { status: 404 });
  if (process.env.PAYABLE_TEST_HOOK === "1" && payableSettlementTestHook) {
    await payableSettlementTestHook(payable.id);
  }
  const amount = line.debitCents / 100;
  if (payable.status !== "open" || Number(payable.remainingBalance) < amount) {
    throw Object.assign(new Error("Settlement exceeds remaining payable balance"), { status: 409 });
  }
  const remainingBalance = Math.round((Number(payable.remainingBalance) - amount) * 100) / 100;
  await tx.insert(payableAllocationsTable).values({
    payableId: payable.id, settlementJournalEntryId: entryId, settlementJournalLineId: lineId, amount,
  });
  await tx.update(payablesTable).set({ remainingBalance, status: remainingBalance === 0 ? "closed" : "open" })
    .where(eq(payablesTable.id, payable.id));
}

async function reverseReceivableEffects(tx: Tx, entryId: number) {
  const [account] = await tx.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable)
    .where(eq(chartOfAccountsTable.code, "1200")).limit(1);
  if (!account) return;
  const lines = await tx.select().from(journalLinesTable)
    .where(and(eq(journalLinesTable.journalEntryId, entryId), eq(journalLinesTable.accountId, account.id)));
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

async function reversePayableEffects(tx: Tx, entryId: number) {
  const [account] = await tx.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable)
    .where(eq(chartOfAccountsTable.code, "2000")).limit(1);
  if (!account) return;
  const lines = await tx.select().from(journalLinesTable)
    .where(and(eq(journalLinesTable.journalEntryId, entryId), eq(journalLinesTable.accountId, account.id)));
  for (const line of lines) {
    const allocation = line.allocation as (PayableAllocationInput & { payableId?: number }) | null;
    if (!allocation) continue;
    if (allocation.kind === "create") {
      if (!allocation.payableId) throw new Error("Payable origin has no linked payable ID");
      const [payable] = await tx.select().from(payablesTable)
        .where(and(eq(payablesTable.id, allocation.payableId), eq(payablesTable.journalEntryId, entryId))).for("update");
      if (!payable) throw new Error("Payable origin not found");
      const [settlement] = await tx.select({ id: payableAllocationsTable.id }).from(payableAllocationsTable)
        .where(eq(payableAllocationsTable.payableId, payable.id)).limit(1);
      if (settlement) throw Object.assign(new Error("Cannot void payable with existing settlements"), { status: 409 });
      await tx.delete(payablesTable).where(eq(payablesTable.id, payable.id));
    } else {
      const [row] = await tx.select().from(payableAllocationsTable)
        .where(eq(payableAllocationsTable.settlementJournalLineId, line.id)).for("update");
      if (!row) throw new Error("Payable settlement allocation not found");
      const [payable] = await tx.select().from(payablesTable)
        .where(eq(payablesTable.id, row.payableId)).for("update");
      if (!payable) throw new Error("Payable not found");
      const remainingBalance = Math.round((Number(payable.remainingBalance) + Number(row.amount)) * 100) / 100;
      await tx.update(payablesTable).set({ remainingBalance, status: "open" }).where(eq(payablesTable.id, payable.id));
      await tx.delete(payableAllocationsTable).where(eq(payableAllocationsTable.id, row.id));
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
  await reversePayableEffects(tx, entry.id);

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