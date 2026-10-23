import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { bankTransactionsTable, cashTransactionsTable, chartOfAccountsTable, db, payrollAdjustmentsTable } from "@workspace/db";
import { readSavedPayroll } from "./payroll-attendance-snapshot.js";
import { attachBankCash } from "./bank-cash-lifecycle.js";
import { checkBankLinkEligibility } from "./bank-link-eligibility.js";
import { assertNotInternalTransfer } from "./bank-internal-transfer.js";
import { lockCashDate } from "./cash-date-lock.js";
import { payrollPayments, payrollPaymentSourceKey } from "./payroll-payments.js";
import { ensurePayrollReceivableJournal } from "./payroll-receivable-posting.js";
import { money } from "./date-utils.js";
import type { Tx } from "./route-shared.js";

type Bank = typeof bankTransactionsTable.$inferSelect;
const fail = (message: string, status = 409) => Object.assign(new Error(message), { status });

async function savedTargets(tx: Tx, bank: Bank, month: string) {
  const payroll = await readSavedPayroll(month, tx);
  if (payroll.closedAt) throw fail("Цалингийн сар хаалттай. Админ эхлээд дахин нээнэ үү.");
  const adjustments = await tx.select().from(payrollAdjustmentsTable).where(eq(payrollAdjustmentsTable.month, month));
  const keys = adjustments.flatMap(row => payrollPayments(row)
    .filter(payment => payment.amount > 0).map(payment => payrollPaymentSourceKey(month, row.employeeId, payment.sequence)));
  const pending = keys.length ? await tx.select().from(cashTransactionsTable).where(and(
    eq(cashTransactionsTable.sourceType, "payroll"),
    inArray(cashTransactionsTable.sourceKey, keys),
    isNull(cashTransactionsTable.bankTransactionId), isNull(cashTransactionsTable.bankVerifiedAt),
    isNull(cashTransactionsTable.unclearAt),
  )) : [];
  const bankDate = bank.transactionAt.toISOString().slice(0, 10);
  return payroll.lines.filter(line => line.calculationReady !== false && !line.openingBalanceReviewRequired)
    .map(line => {
      const ownedKeys = new Set(payrollPayments(adjustments.find(row => row.employeeId === line.employeeId))
        .map(payment => payrollPaymentSourceKey(month, line.employeeId, payment.sequence)));
      const existing = pending.filter(cash => ownedKeys.has(cash.sourceKey!)
        && Math.abs(Number(cash.amount) - Number(bank.amount)) < 1
        && Math.abs(Date.parse(String(cash.date)) - Date.parse(bankDate)) <= 7 * 86400000)
        .sort((a, b) => Math.abs(Date.parse(String(a.date)) - Date.parse(bankDate))
          - Math.abs(Date.parse(String(b.date)) - Date.parse(bankDate)) || a.id - b.id)[0];
      return {
        employeeId: line.employeeId, employeeName: line.employeeName, month,
        payable: line.payable, paidAmount: line.paidAmount,
        remainingBalance: Math.max(0, line.balanceAmount), existingCashId: existing?.id ?? null,
      };
    }).filter(line => line.remainingBalance > 1 || line.existingCashId !== null);
}

export async function listBankPayrollTargets(bankId: number, month: string) {
  return db.transaction(async tx => {
    const [bank] = await tx.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    if (!bank) throw fail("Банкны гүйлгээ олдсонгүй", 404);
    await assertNotInternalTransfer(tx, bankId);
    if (bank.type !== "expense" || bank.cashTransactionId || bank.journalEntryId || bank.transferredAt || bank.unclearAt) return [];
    return savedTargets(tx, bank, month);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** One bank movement creates/claims exactly one salary payment; no new earnings or generic payable. */
export async function linkBankPayroll(bankId: number, employeeId: number, month: string) {
  return db.transaction(async tx => {
    // Same serialization as manual salary writes and schedule/month closure.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20260919)`);
    const [bank] = await tx.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId)).for("update");
    if (!bank) throw fail("Банкны гүйлгээ олдсонгүй", 404);
    await assertNotInternalTransfer(tx, bankId);
    const prefix = `${month}:${employeeId}`;
    const result = async (cashId: number, reusedPayment: boolean) => {
      const payroll = await readSavedPayroll(month, tx);
      const line = payroll.lines.find(row => row.employeeId === employeeId);
      if (!line) throw fail("Хадгалсан цалинд ажилтан олдсонгүй", 404);
      return { bankTransactionId: bankId, cashTransactionId: cashId, employeeId, month,
        paidAmount: line.paidAmount, remainingBalance: Math.max(0, line.balanceAmount), reusedPayment };
    };
    if (bank.cashTransactionId !== null) {
      const [cash] = await tx.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, bank.cashTransactionId));
      if (cash?.sourceType === "payroll" && (cash.sourceKey === prefix || cash.sourceKey?.startsWith(`${prefix}:`))
        && cash.bankTransactionId === bankId && cash.journalEntryId !== null && cash.journalEntryId === bank.journalEntryId) {
        return result(cash.id, true);
      }
      throw fail("Банкны гүйлгээ аль хэдийн өөр бүртгэлтэй холбогдсон байна");
    }
    const date = bank.transactionAt.toISOString().slice(0, 10);
    if (bank.type !== "expense" || Number(bank.amount) <= 0) throw fail("Зөвхөн банкны зарлагыг цалингийн төлөлтөд холбоно", 400);
    const eligibility = await checkBankLinkEligibility(tx, bank, "cash", date);
    if (eligibility.issue) throw fail("Банкны гүйлгээ холбогдсон эсвэл өөр төрлийн баримт шаардлагатай байна. Цалингийн гүйлгээ эсэх, GL дансаа шалгана уу.");
    // Explicit payroll selection must not silently keep an unrelated expense GL account.
    if (bank.accountId !== null) {
      const [account] = await tx.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, bank.accountId));
      if (account?.code !== "6000" || !account.isActive) throw fail("Цалинд холбохын өмнө банкны GL дансыг 6000 — Цалин болгож сонгоно уу.");
    }
    const target = (await savedTargets(tx, bank, month)).find(line => line.employeeId === employeeId);
    if (!target) throw fail("Бодогдсон цалингийн төлөгдөөгүй үлдэгдэл эсвэл холбох төлөлт олдсонгүй.");
    let cash: typeof cashTransactionsTable.$inferSelect | undefined;
    if (target.existingCashId !== null) {
      [cash] = await tx.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.id, target.existingCashId)).for("update");
      if (!cash || cash.bankTransactionId !== null || cash.bankVerifiedAt !== null) throw fail("Төлөлт өөр банкны гүйлгээнд холбогдсон байна");
    }
    const cashDate = cash ? String(cash.date) : date;
    await lockCashDate(tx, cashDate);
    const currentEligibility = await checkBankLinkEligibility(tx, bank, "cash", cashDate);
    if (currentEligibility.closed) throw fail("Өндөрлөсөн өдрийн цалингийн төлөлтийг холбох боломжгүй");
    const reused = Boolean(cash);
    if (!cash) {
      if (money(Number(bank.amount)) > money(target.remainingBalance)) throw fail("Банкны дүн цалингийн төлөгдөөгүй үлдэгдлээс их байна. Илүү төлөлтийг автоматаар бүртгэхгүй.");
      const [account] = await tx.select().from(chartOfAccountsTable).where(and(eq(chartOfAccountsTable.code, "6000"), eq(chartOfAccountsTable.isActive, true)));
      if (!account || account.type !== "expense") throw fail("6000 — Цалин данс идэвхтэй байх шаардлагатай");
      const [old] = await tx.select().from(payrollAdjustmentsTable).where(and(
        eq(payrollAdjustmentsTable.month, month), eq(payrollAdjustmentsTable.employeeId, employeeId),
      )).for("update");
      const existing = payrollPayments(old);
      const sequence = existing.find(payment => payment.amount === 0)?.sequence
        ?? Math.max(2, ...existing.map(payment => payment.sequence)) + 1;
      if (sequence > 10000 || (sequence > 2 && (old?.additionalPayments.length ?? 0) >= 1000)) throw fail("Цалингийн нэмэлт олголтын тоо хязгаарт хүрсэн байна");
      const amount = money(Number(bank.amount));
      const paymentFields = sequence === 1 ? { paidAmount: amount, paymentDate: date }
        : sequence === 2 ? { secondPaidAmount: amount, secondPaymentDate: date }
          : { additionalPayments: [...(old?.additionalPayments ?? []), { sequence, amount, date }] };
      const [adjustment] = await tx.insert(payrollAdjustmentsTable).values({ employeeId, month, ...paymentFields })
        .onConflictDoUpdate({ target: [payrollAdjustmentsTable.employeeId, payrollAdjustmentsTable.month],
          set: { ...paymentFields, updatedAt: new Date() } }).returning();
      if (adjustment.receivableId !== null && adjustment.journalEntryId === null) {
        const journalEntryId = await ensurePayrollReceivableJournal(tx, {
          employeeId, employeeName: target.employeeName, month, amount: Number(adjustment.manualDeduction),
          receivableId: adjustment.receivableId, date, adjustmentId: adjustment.id, journalEntryId: null,
        });
        await tx.update(payrollAdjustmentsTable).set({ journalEntryId }).where(eq(payrollAdjustmentsTable.id, adjustment.id));
      }
      [cash] = await tx.insert(cashTransactionsTable).values({
        type: "expense", category: "Цалин", accountId: account.id, amount, date,
        description: `${target.employeeName} · ${month} сарын цалин${sequence === 1 ? "" : ` · ${sequence}-р олголт`}`,
        sourceType: "payroll", sourceKey: payrollPaymentSourceKey(month, employeeId, sequence),
      }).returning();
    }
    await attachBankCash(tx, bank, cash);
    return result(cash.id, reused);
  });
}
