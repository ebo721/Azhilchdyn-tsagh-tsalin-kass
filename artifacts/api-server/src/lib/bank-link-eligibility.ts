import { eq } from "drizzle-orm";
import { bankTransactionsTable, cashClosuresTable, chartOfAccountsTable } from "@workspace/db";
import { inventoryPurchaseAccountCodes, type Tx } from "./route-shared.js";

type BankRow = typeof bankTransactionsTable.$inferSelect;
type LinkTarget = "cash" | "purchase" | "expense" | "fixed_asset";
type LinkIssue = "bank_resolved" | "purchase_document_required" | "fixed_asset_document_required";

/**
 * Shared bank-side eligibility rules. Call with a locked bank row; callers retain
 * their own document/cash checks and choose when to report a closed date.
 */
export async function checkBankLinkEligibility(
  tx: Tx,
  bank: BankRow,
  target: LinkTarget,
  cashDate?: string,
): Promise<{ issue: LinkIssue | null; closed: boolean }> {
  if ((target !== "cash" && bank.type !== "expense")
    || bank.cashTransactionId !== null
    || bank.transferredAt !== null
    || bank.unclearAt !== null
    || bank.journalEntryId !== null) {
    return { issue: "bank_resolved", closed: false };
  }

  if (bank.type === "expense" && bank.accountId !== null) {
    const [account] = await tx.select({ code: chartOfAccountsTable.code })
      .from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, bank.accountId));
    const code = account?.code;
    if (target !== "purchase" && inventoryPurchaseAccountCodes.some((purchaseCode) => purchaseCode === code)) {
      return { issue: "purchase_document_required", closed: false };
    }
    if (target !== "fixed_asset" && code === "1800") {
      return { issue: "fixed_asset_document_required", closed: false };
    }
  }

  const date = target === "cash" ? cashDate : bank.transactionAt.toISOString().slice(0, 10);
  if (!date) throw new Error("Cash date is required to check bank-link eligibility");
  const [closure] = await tx.select({ id: cashClosuresTable.id })
    .from(cashClosuresTable).where(eq(cashClosuresTable.date, date));
  return { issue: null, closed: Boolean(closure) };
}