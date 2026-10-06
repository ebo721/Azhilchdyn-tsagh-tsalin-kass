import { and, eq, inArray, or } from "drizzle-orm";
import { bankTransactionsTable, cashTransactionsTable, cashClosuresTable, chartOfAccountsTable, journalEntriesTable, operatingExpensesTable } from "@workspace/db";
import { lockCashDate } from "./cash-date-lock.js";
import { postJournalEntry, voidJournalEntry } from "./journal-posting.js";
import { inventoryPurchaseAccountCodes, type Tx } from "./route-shared.js";

type Bank = typeof bankTransactionsTable.$inferSelect;
type Cash = typeof cashTransactionsTable.$inferSelect;
type Account = typeof chartOfAccountsTable.$inferSelect;
const conflict = (message: string) => Object.assign(new Error(message), { status: 409 });

export async function accountByCode(tx: Tx, code: string, type: string) {
  const [account] = await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.code, code), eq(chartOfAccountsTable.type, type), eq(chartOfAccountsTable.isActive, true),
  ));
  if (!account) throw conflict(`Journal account ${code} is missing or inactive`);
  return account;
}

export async function postBankCashJournal(tx: Tx, bank: Bank, cash: Cash, counter: Account) {
  const funding = await accountByCode(tx, "1010", "asset");
  const amount = Number(bank.amount);
  const result = await postJournalEntry(tx, {
    date: bank.transactionAt.toISOString().slice(0, 10),
    description: bank.description.trim() || bank.counterparty.trim() || cash.description.trim(),
    sourceType: "bank_transaction", sourceId: bank.id, createdBy: null,
    lines: cash.type === "income"
      ? [{ accountId: funding.id, debit: amount, credit: 0 }, { accountId: counter.id, debit: 0, credit: amount }]
      : [{ accountId: counter.id, debit: amount, credit: 0 }, { accountId: funding.id, debit: 0, credit: amount }],
  });
  if (result.status !== "posted") throw conflict("Bank cash journal entry must be balanced");
  return result.journalEntryId;
}

async function lockedPair(tx: Tx, id: number) {
  const [snapshot] = await tx.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
  if (!snapshot) throw Object.assign(new Error("Банкны гүйлгээ олдсонгүй"), { status: 404 });
  if (snapshot.cashTransactionId === null) throw conflict("Банк–кассын холбоос алга.");
  const [cashSnapshot] = await tx.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, snapshot.cashTransactionId));
  if (!cashSnapshot) throw conflict("Холбогдсон кассын гүйлгээ олдсонгүй.");
  const bankDate = snapshot.transactionAt.toISOString().slice(0, 10);
  const dates = [...new Set([bankDate, String(cashSnapshot.date)])].sort();
  for (const date of dates) await lockCashDate(tx, date);
  const [bank] = await tx.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id)).for("update");
  const [cash] = await tx.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, cashSnapshot.id)).for("update");
  if (!bank || !cash || bank.cashTransactionId !== cash.id || cash.bankTransactionId !== bank.id
    || !bank.transferredAt || !cash.bankVerifiedAt
    || bank.transactionAt.toISOString().slice(0, 10) !== bankDate || cash.date !== cashSnapshot.date) {
    throw conflict("Банк–кассын холбоос өөрчлөгдсөн эсвэл бүрэн бус байна. Дахин ачаална уу.");
  }
  if ((await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(inArray(cashClosuresTable.date, dates)).limit(1)).length) {
    throw conflict("Өндөрлөсөн өдрийн холбоос, журналыг өөрчлөх боломжгүй.");
  }
  if (cash.sourceType !== null && !["bank_transaction", "payroll", "payroll_advance"].includes(cash.sourceType)) {
    throw conflict("Энэ төлбөр баримттай холбоотой тул эх үүсвэр цэснээс цуцална уу.");
  }
  if (bank.journalEntryId !== cash.journalEntryId) throw conflict("Банк, кассын журналын холбоос зөрсөн байна.");
  const expenses = await tx.select().from(operatingExpensesTable)
    .where(or(eq(operatingExpensesTable.bankTransactionId, id), eq(operatingExpensesTable.cashTransactionId, cash.id)));
  if (expenses.some((expense) => expense.cashTransactionId !== cash.id || (expense.bankTransactionId !== null && expense.bankTransactionId !== id))) {
    throw conflict("Энэ төлбөр өөр зардлын баримттай холбоотой тул эх үүсвэр цэснээс цуцална уу.");
  }
  return { bank, cash };
}

export async function unlinkBankCash(tx: Tx, id: number, userId: number | null, requireJournal = false) {
  const { bank, cash } = await lockedPair(tx, id);
  // Preserve the legacy journal-delete protection; explicit unlink is a separate correction.
  if (requireJournal && (await tx.select({ id: operatingExpensesTable.id }).from(operatingExpensesTable)
    .where(or(eq(operatingExpensesTable.bankTransactionId, id), eq(operatingExpensesTable.cashTransactionId, cash.id))).limit(1)).length) {
    throw conflict("Энэ журнал зардлын бүртгэлтэй холбоотой тул холбоос салгах тусдаа үйлдлийг ашиглана уу.");
  }
  let reversalJournalEntryId: number | null = null;
  if (requireJournal && bank.journalEntryId === null) throw conflict("Устгах батлагдсан банкны журнал алга.");
  if (bank.journalEntryId !== null) {
    const [entry] = await tx.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, bank.journalEntryId)).for("update");
    if (!entry || entry.sourceType !== "bank_transaction" || entry.sourceId !== id || entry.status !== "posted") {
      throw conflict("Энэ журнал өөр эх үүсвэртэй холбоотой тул эх үүсвэр цэснээс цуцална уу.");
    }
    reversalJournalEntryId = (await voidJournalEntry(tx, { journalEntryId: entry.id, voidedBy: userId })).reversalEntryId;
  }
  await tx.update(bankTransactionsTable).set({ cashTransactionId: null, transferredAt: null, journalEntryId: null }).where(eq(bankTransactionsTable.id, id));
  await tx.update(cashTransactionsTable).set({
    bankTransactionId: null, bankVerifiedAt: null, journalEntryId: null,
    ...(cash.sourceType === "bank_transaction" ? { sourceType: null, sourceKey: null } : {}),
  }).where(eq(cashTransactionsTable.id, cash.id));
  // Automatic cash expense mirrors remain cash-paid; only bank provenance is removed.
  await tx.update(operatingExpensesTable).set({ bankTransactionId: null })
    .where(and(eq(operatingExpensesTable.cashTransactionId, cash.id), eq(operatingExpensesTable.bankTransactionId, id)));
  return { bankTransactionId: id, cashTransactionId: cash.id, voidedJournalEntryId: bank.journalEntryId, reversalJournalEntryId };
}

export async function restoreBankCashJournal(tx: Tx, id: number, accountId: number) {
  const { bank, cash } = await lockedPair(tx, id);
  const tolerance = ["payroll", "payroll_advance"].includes(cash.sourceType ?? "") ? 1 : 0;
  if (bank.type !== cash.type || Math.abs(Number(bank.amount) - Number(cash.amount)) > tolerance) throw conflict("Холбогдсон гүйлгээний төрөл эсвэл дүн зөрсөн байна.");
  if (bank.journalEntryId !== null) {
    const [entry] = await tx.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, bank.journalEntryId));
    if (!entry || entry.status !== "posted" || entry.sourceType !== "bank_transaction" || entry.sourceId !== id) throw conflict("Одоогийн журнал өөр эх үүсвэртэй байна.");
    return { bankTransactionId: id, cashTransactionId: cash.id, journalEntryId: entry.id };
  }
  const [account] = await tx.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, accountId));
  if (!account?.isActive || ["1000", "1010", "1200"].includes(account.code)
    || !(cash.type === "income" ? account.type === "revenue" : ["expense", "asset"].includes(account.type))) {
    throw conflict("Гүйлгээний төрөлд тохирох идэвхтэй эсрэг GL данс сонгоно уу.");
  }
  if (account.code === "1800" || inventoryPurchaseAccountCodes.some((code) => account.code.startsWith(code))) {
    throw conflict("Бараа, эд хөрөнгийн төлбөрийг эх баримтын цэснээс журналд бичнэ.");
  }
  // Reuse the original bank-funded posting path; never post a linked payment as cash (1000).
  const journalEntryId = await postBankCashJournal(tx, bank, cash, account);
  await tx.update(bankTransactionsTable).set({ journalEntryId, accountId: account.id }).where(eq(bankTransactionsTable.id, id));
  await tx.update(cashTransactionsTable).set({ journalEntryId, accountId: account.id }).where(eq(cashTransactionsTable.id, cash.id));
  await tx.update(operatingExpensesTable).set({ accountId: account.id })
    .where(and(eq(operatingExpensesTable.cashTransactionId, cash.id), eq(operatingExpensesTable.bankTransactionId, id)));
  return { bankTransactionId: id, cashTransactionId: cash.id, journalEntryId };
}
