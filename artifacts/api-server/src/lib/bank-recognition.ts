import {
  bankTransactionsTable,
  chartOfAccountsTable,
  db,
  inventoryPurchasesTable,
  operatingExpensesTable,
} from "@workspace/db";
import { and, desc, eq, isNotNull, isNull, or } from "drizzle-orm";
import { bankKeywordRecognitionRules } from "./bank-recognition-rules.js";
import { ensureDefaultChartOfAccounts } from "./route-shared.js";

export type RecognizableBankTransaction = {
  transactionAt: Date;
  type: string;
  amount: number;
  account: string;
  counterparty: string;
  description: string;
  bankAccountNumber: string | null;
  rejectedAccountIds?: readonly number[];
};

export type BankRecognitionContext = {
  unpaidTargets: Array<{
    id: number;
    kind: "inventory_purchase" | "operating_expense";
    accountId: number;
    date: string;
    amount: number;
    text: string;
  }>;
  historical: Array<{
    id: number;
    type: string;
    accountId: number;
    account: string;
    counterparty: string;
    bankAccountNumber: string | null;
  }>;
  keywordAccounts: Map<string, number>;
};

export type BankRecognitionResult = {
  accountId: number | null;
  rule: "unpaid_target" | "historical_identity" | "keyword" | "none";
  existingPurchaseMatch: {
    type: "inventory_purchase" | "operating_expense";
    id: number;
  } | null;
};

const normalize = (value: string | null | undefined) =>
  (value ?? "").trim().toLocaleLowerCase("mn-MN").replace(/\s+/g, " ");

const tokens = (value: string) =>
  new Set(normalize(value).match(/[\p{L}\p{N}]+/gu) ?? []);

const normalizedTokenText = (value: string) =>
  [...tokens(value)].join(" ");

const relatedTokens = (left: string, right: string) =>
  left === right
  || (Math.min(left.length, right.length) >= 4 && (left.startsWith(right) || right.startsWith(left)));

const daysBetween = (left: string, right: string) =>
  Math.abs((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000);

function unpaidTargetMatch(
  transaction: RecognizableBankTransaction,
  targets: BankRecognitionContext["unpaidTargets"],
) {
  if (transaction.type !== "expense") return null;
  const bankDate = transaction.transactionAt.toISOString().slice(0, 10);
  const bankTokens = tokens(`${transaction.counterparty} ${transaction.account} ${transaction.description}`);
  const rejected = new Set(transaction.rejectedAccountIds ?? []);
  const candidates = targets.flatMap((target) => {
    if (rejected.has(target.accountId)) return [];
    if (Math.abs(target.amount - transaction.amount) >= 0.01) return [];
    const distance = daysBetween(target.date, bankDate);
    if (distance > 7) return [];
    const targetTokens = tokens(target.text);
    const overlap = [...targetTokens]
      .filter((targetToken) => [...bankTokens].some((bankToken) => relatedTokens(targetToken, bankToken)))
      .length;
    if (overlap === 0) return [];
    const score = 100 - distance * 5 + overlap * 10;
    return [{ ...target, score }];
  }).sort((left, right) => right.score - left.score || right.id - left.id);
  const [best, runnerUp] = candidates;
  if (!best) return null;
  if (runnerUp && runnerUp.score === best.score && runnerUp.accountId !== best.accountId) return null;
  return best;
}

function historicalIdentityAccount(
  transaction: RecognizableBankTransaction,
  historical: BankRecognitionContext["historical"],
) {
  const currentIdentities = new Set(
    [transaction.counterparty, transaction.account].map(normalize).filter(Boolean),
  );
  const currentBankAccount = normalize(transaction.bankAccountNumber);
  const rejected = new Set(transaction.rejectedAccountIds ?? []);
  for (const row of historical) {
    if (row.type !== transaction.type) continue;
    if (rejected.has(row.accountId)) continue;
    const identityMatch = [row.counterparty, row.account]
      .map(normalize)
      .some((value) => value && currentIdentities.has(value));
    const bankAccountAndCounterpartyMatch = Boolean(
      currentBankAccount
      && currentBankAccount === normalize(row.bankAccountNumber)
      && normalize(transaction.counterparty)
      && normalize(transaction.counterparty) === normalize(row.counterparty),
    );
    if (identityMatch || bankAccountAndCounterpartyMatch) return row.accountId;
  }
  return null;
}

function keywordAccount(
  transaction: RecognizableBankTransaction,
  keywordAccounts: BankRecognitionContext["keywordAccounts"],
  priorityOnly = false,
) {
  const description = normalize(transaction.description);
  const rejected = new Set(transaction.rejectedAccountIds ?? []);
  const rule = bankKeywordRecognitionRules.find((candidate) =>
    candidate.direction === transaction.type
    && !rejected.has(keywordAccounts.get(candidate.accountCode) ?? -1)
    && (priorityOnly ? candidate.priorityKeywords ?? [] : candidate.keywords).some((keyword) => {
      const keywordText = normalizedTokenText(keyword);
      return keywordText && ` ${normalizedTokenText(description)} `.includes(` ${keywordText} `);
    }));
  return rule ? keywordAccounts.get(rule.accountCode) ?? null : null;
}

export function recognizeBankTransaction(
  transaction: RecognizableBankTransaction,
  context: BankRecognitionContext,
): BankRecognitionResult {
  const target = unpaidTargetMatch(transaction, context.unpaidTargets);
  if (target !== null) return {
    accountId: target.accountId,
    rule: "unpaid_target",
    existingPurchaseMatch: { type: target.kind, id: target.id },
  };
  const documentCategoryAccountId = keywordAccount(
    transaction,
    context.keywordAccounts,
    true,
  );
  if (documentCategoryAccountId !== null) {
    return { accountId: documentCategoryAccountId, rule: "keyword", existingPurchaseMatch: null };
  }
  const historicalAccountId = historicalIdentityAccount(transaction, context.historical);
  if (historicalAccountId !== null) return {
    accountId: historicalAccountId,
    rule: "historical_identity",
    existingPurchaseMatch: null,
  };
  const keywordAccountId = keywordAccount(transaction, context.keywordAccounts);
  if (keywordAccountId !== null) return { accountId: keywordAccountId, rule: "keyword", existingPurchaseMatch: null };
  return { accountId: null, rule: "none", existingPurchaseMatch: null };
}

export async function loadBankRecognitionContext(): Promise<BankRecognitionContext> {
  await ensureDefaultChartOfAccounts(db);
  const [purchases, expenses, historical, accounts] = await Promise.all([
    db.select({
      id: inventoryPurchasesTable.id,
      accountId: inventoryPurchasesTable.accountId,
      date: inventoryPurchasesTable.date,
      amount: inventoryPurchasesTable.totalAmount,
      text: inventoryPurchasesTable.documentName,
    }).from(inventoryPurchasesTable)
      .innerJoin(chartOfAccountsTable, eq(inventoryPurchasesTable.accountId, chartOfAccountsTable.id))
      .where(and(
        isNull(inventoryPurchasesTable.paymentDate),
        isNotNull(inventoryPurchasesTable.accountId),
        eq(chartOfAccountsTable.isActive, true),
      ))
      .orderBy(desc(inventoryPurchasesTable.date), desc(inventoryPurchasesTable.id)),
    db.select({
      id: operatingExpensesTable.id,
      accountId: operatingExpensesTable.accountId,
      date: operatingExpensesTable.date,
      amount: operatingExpensesTable.amount,
      description: operatingExpensesTable.description,
      accountName: chartOfAccountsTable.name,
    }).from(operatingExpensesTable)
      .innerJoin(chartOfAccountsTable, eq(operatingExpensesTable.accountId, chartOfAccountsTable.id))
      .where(and(
        isNull(operatingExpensesTable.paymentDate),
        isNull(operatingExpensesTable.bankTransactionId),
        isNull(operatingExpensesTable.cashTransactionId),
        eq(chartOfAccountsTable.isActive, true),
      ))
      .orderBy(desc(operatingExpensesTable.date), desc(operatingExpensesTable.id)),
    db.select({
      id: bankTransactionsTable.id,
      type: bankTransactionsTable.type,
      accountId: bankTransactionsTable.accountId,
      account: bankTransactionsTable.account,
      counterparty: bankTransactionsTable.counterparty,
      bankAccountNumber: bankTransactionsTable.bankAccountNumber,
    }).from(bankTransactionsTable)
      .innerJoin(chartOfAccountsTable, eq(bankTransactionsTable.accountId, chartOfAccountsTable.id))
      .where(and(
        isNotNull(bankTransactionsTable.accountId),
        eq(chartOfAccountsTable.isActive, true),
        or(
          isNotNull(bankTransactionsTable.journalEntryId),
          isNotNull(bankTransactionsTable.transferredAt),
          isNotNull(bankTransactionsTable.cashTransactionId),
        ),
      ))
      .orderBy(desc(bankTransactionsTable.transactionAt), desc(bankTransactionsTable.id)),
    db.select({
      id: chartOfAccountsTable.id,
      code: chartOfAccountsTable.code,
    }).from(chartOfAccountsTable).where(eq(chartOfAccountsTable.isActive, true)),
  ]);
  return {
    unpaidTargets: [
      ...purchases.flatMap((purchase) => purchase.accountId === null ? [] : [{
        id: purchase.id,
        kind: "inventory_purchase" as const,
        accountId: purchase.accountId,
        date: purchase.date,
        amount: Number(purchase.amount),
        text: purchase.text,
      }]),
      ...expenses.map((expense) => ({
        id: expense.id,
        kind: "operating_expense" as const,
        accountId: expense.accountId,
        date: expense.date,
        amount: Number(expense.amount),
        text: `${expense.description} ${expense.accountName}`,
      })),
    ],
    historical: historical.flatMap((row) => row.accountId === null ? [] : [{
      ...row,
      accountId: row.accountId,
    }]),
    keywordAccounts: new Map(accounts.map((account) => [account.code, account.id])),
  };
}