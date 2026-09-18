import { and, eq, isNull, sql } from "drizzle-orm";
import {
  bankTransactionsTable, cashClosuresTable, cashTransactionsTable,
  chartOfAccountsTable, db, inventoryItemsTable, inventoryPurchaseItemsTable,
  inventoryPurchasesTable, inventorySuppliersTable, operatingExpensesTable,
} from "@workspace/db";
import { cashAccountForCategory } from "./cash-account.js";
import { inventoryMaterialLabel, inventoryPurchaseAccount, money } from "./route-shared.js";
import { postJournalEntry } from "./journal-posting.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type PurchaseInput = { inventoryPurchaseId: number } | {
  materialType: "food" | "supply"; supplierName: string; hasReceipt: boolean; date: string;
  items: Array<{ inventoryItemId?: number; name: string; category: string; unit: string; quantity: number; unitPrice: number }>;
};
type ExpenseInput = { operatingExpenseId: number } | { description: string; accountId: number; date: string; amount: number };
export type LinkResult = { bankTransactionId: number; inventoryPurchaseId: number; cashTransactionId: number; journalEntryId: number }
  | { bankTransactionId: number; operatingExpenseId: number; cashTransactionId: number; journalEntryId: number };

export async function linkBankPurchase(id: number, input: PurchaseInput): Promise<LinkResult | string> {
  return db.transaction(async (tx) => {
    let purchase: any = null;
    if ("inventoryPurchaseId" in input) {
      [purchase] = await tx.select().from(inventoryPurchasesTable)
        .where(eq(inventoryPurchasesTable.id, input.inventoryPurchaseId))
        .for("update");
      if (!purchase) return "missing_purchase";
    }
    const [bank] = await tx.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id)).for("update");
    if (!bank) return "missing_bank";
    if (bank.type !== "expense" || bank.cashTransactionId !== null || bank.transferredAt !== null || bank.unclearAt !== null || bank.journalEntryId !== null) return "bank_resolved";
    const date = bank.transactionAt.toISOString().slice(0, 10);
    const [closed] = await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(eq(cashClosuresTable.date, date));
    if (closed) return "closed";
    if ("inventoryPurchaseId" in input) {
      if (purchase.paymentDate !== null || purchase.date !== date || money(Number(purchase.totalAmount)) !== money(Number(bank.amount))) return "purchase_conflict";
    } else {
      const supplier = input.supplierName.normalize("NFKC").trim().replace(/\s+/g, " ");
      const items = input.items.map((item) => ({ ...item, name: item.name.trim(), category: item.category.trim(), totalAmount: money(item.quantity * item.unitPrice) }));
      const total = money(items.reduce((sum, item) => sum + item.totalAmount, 0));
      if (!supplier || items.some((item) => !item.name || !item.category)) return "invalid_input";
      if (input.date !== date || money(total) !== money(Number(bank.amount))) return "bank_mismatch";
      const account = await inventoryPurchaseAccount(tx, input.materialType);
      const resolvedCatalogItems = [];
      for (const item of items) {
        const normalizedName = item.name.toLocaleLowerCase("mn-MN");
        const [catalog] = item.inventoryItemId
          ? await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, item.inventoryItemId))
          : await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.normalizedName, normalizedName));
        if (item.inventoryItemId && !catalog) return "invalid_input";
        if (catalog && catalog.materialType !== input.materialType) return "inventory_item_conflict";
        resolvedCatalogItems.push({ item, normalizedName, catalog });
      }
      const normalized = supplier.toLocaleLowerCase("mn-MN");
      let [vendor] = await tx.select().from(inventorySuppliersTable).where(eq(inventorySuppliersTable.normalizedName, normalized));
      if (!vendor) [vendor] = await tx.insert(inventorySuppliersTable).values({ name: supplier, normalizedName: normalized }).onConflictDoNothing().returning();
      if (!vendor) [vendor] = await tx.select().from(inventorySuppliersTable).where(eq(inventorySuppliersTable.normalizedName, normalized));
      [purchase] = await tx.insert(inventoryPurchasesTable).values({ materialType: input.materialType, accountId: account.id, documentName: vendor.name, hasReceipt: input.hasReceipt, date, totalAmount: money(total) }).returning();
      const lines: any[] = [];
      for (const resolved of resolvedCatalogItems) {
        const { item, normalizedName } = resolved;
        let { catalog } = resolved;
        if (!catalog) [catalog] = await tx.insert(inventoryItemsTable).values({ materialType: input.materialType, name: item.name, normalizedName, category: item.category, unit: item.unit, quantity: 0 }).returning();
        await tx.update(inventoryItemsTable).set({ quantity: sql`${inventoryItemsTable.quantity} + ${item.quantity}` }).where(eq(inventoryItemsTable.id, catalog.id));
        lines.push({ purchaseId: purchase.id, inventoryItemId: catalog.id, name: catalog.name, category: catalog.category, unit: catalog.unit, quantity: item.quantity, remainingQuantity: item.quantity, unitPrice: money(item.unitPrice), totalAmount: money(item.totalAmount) });
      }
      await tx.insert(inventoryPurchaseItemsTable).values(lines);
    }
    const amount = money(Number(bank.amount));
    const canonicalPurchaseAccount = await inventoryPurchaseAccount(tx, purchase.materialType);
    if (purchase.accountId !== canonicalPurchaseAccount.id) return "purchase_conflict";
    const category = inventoryMaterialLabel(purchase.materialType);
    const cashAccount = await cashAccountForCategory(tx, category);
    const [cash] = await tx.insert(cashTransactionsTable).values({ type: "expense", category, accountId: cashAccount?.id ?? null, description: purchase.documentName, amount, date, sourceType: "inventory_purchase", sourceKey: `purchase:${purchase.id}`, bankTransactionId: id, bankVerifiedAt: new Date() }).returning();
    const [claimed] = await tx.update(bankTransactionsTable).set({ cashTransactionId: cash.id, transferredAt: new Date() }).where(and(eq(bankTransactionsTable.id, id), isNull(bankTransactionsTable.cashTransactionId), isNull(bankTransactionsTable.transferredAt))).returning();
    if (!claimed) throw new Error("Bank transaction was claimed concurrently");
    const [settlement] = await tx.select().from(chartOfAccountsTable).where(and(eq(chartOfAccountsTable.code, "1010"), eq(chartOfAccountsTable.type, "asset"), eq(chartOfAccountsTable.isActive, true)));
    const [inventory] = await tx.select().from(chartOfAccountsTable).where(and(eq(chartOfAccountsTable.id, purchase.accountId), eq(chartOfAccountsTable.isActive, true)));
    if (!settlement || !inventory) throw new Error("Inventory or bank account is missing or inactive");
    const posting = await postJournalEntry(tx, { date, description: purchase.documentName, sourceType: "inventory_purchase", sourceId: purchase.id, createdBy: null, lines: [{ accountId: inventory.id, debit: amount, credit: 0 }, { accountId: settlement.id, debit: 0, credit: amount }] });
    if (posting.status !== "posted") throw new Error("Inventory purchase journal entry must be balanced");
    await tx.update(cashTransactionsTable).set({ journalEntryId: posting.journalEntryId }).where(eq(cashTransactionsTable.id, cash.id));
    await tx.update(inventoryPurchasesTable).set({ paymentDate: date, paymentAmount: amount }).where(eq(inventoryPurchasesTable.id, purchase.id));
    return { bankTransactionId: id, inventoryPurchaseId: purchase.id, cashTransactionId: cash.id, journalEntryId: posting.journalEntryId };
  });
}

export async function linkBankExpense(id: number, input: ExpenseInput): Promise<LinkResult | string> {
  return db.transaction(async (tx) => {
    let expense: any = null;
    if ("operatingExpenseId" in input) {
      [expense] = await tx.select().from(operatingExpensesTable)
        .where(eq(operatingExpensesTable.id, input.operatingExpenseId))
        .for("update");
      if (!expense) return "missing_expense";
    }
    const [bank] = await tx.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id)).for("update");
    if (!bank) return "missing_bank";
    if (bank.type !== "expense" || bank.cashTransactionId !== null || bank.transferredAt !== null || bank.unclearAt !== null || bank.journalEntryId !== null) return "bank_resolved";
    const date = bank.transactionAt.toISOString().slice(0, 10);
    const [closed] = await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable).where(eq(cashClosuresTable.date, date));
    if (closed) return "closed";
    if ("operatingExpenseId" in input) {
      if (expense.paymentDate !== null || expense.date !== date || money(Number(expense.amount)) !== money(Number(bank.amount))) return "expense_conflict";
    } else {
      if (input.date !== date || money(input.amount) !== money(Number(bank.amount))) return "bank_mismatch";
      const [account] = await tx.select().from(chartOfAccountsTable).where(and(eq(chartOfAccountsTable.id, input.accountId), eq(chartOfAccountsTable.type, "expense"), eq(chartOfAccountsTable.isActive, true))).for("update");
      if (!account) return "invalid_account";
      [expense] = await tx.insert(operatingExpensesTable).values({ description: input.description.trim(), accountId: account.id, date, amount: money(Number(bank.amount)) }).returning();
    }
    const [expenseAccount] = await tx.select().from(chartOfAccountsTable).where(and(eq(chartOfAccountsTable.id, expense.accountId), eq(chartOfAccountsTable.type, "expense"), eq(chartOfAccountsTable.isActive, true)));
    const settlement = await tx.select().from(chartOfAccountsTable).where(and(eq(chartOfAccountsTable.code, "1010"), eq(chartOfAccountsTable.type, "asset"), eq(chartOfAccountsTable.isActive, true)));
    if (!expenseAccount || !settlement[0]) throw new Error("Operating expense or bank account is missing or inactive");
    const amount = money(Number(bank.amount));
    const cashAccount = await cashAccountForCategory(tx, "Үйл ажиллагааны зардал");
    const [cash] = await tx.insert(cashTransactionsTable).values({ type: "expense", category: "Үйл ажиллагааны зардал", accountId: cashAccount?.id ?? null, description: expense.description, amount, date, sourceType: "operating_expense", sourceKey: `expense:${expense.id}`, bankTransactionId: id, bankVerifiedAt: new Date() }).returning();
    const [claimed] = await tx.update(bankTransactionsTable).set({ cashTransactionId: cash.id, transferredAt: new Date() }).where(and(eq(bankTransactionsTable.id, id), isNull(bankTransactionsTable.cashTransactionId), isNull(bankTransactionsTable.transferredAt))).returning();
    if (!claimed) throw new Error("Bank transaction was claimed concurrently");
    const posting = await postJournalEntry(tx, { date, description: expense.description, sourceType: "cash", sourceId: cash.id, createdBy: null, lines: [{ accountId: expenseAccount.id, debit: amount, credit: 0 }, { accountId: settlement[0].id, debit: 0, credit: amount }] });
    if (posting.status !== "posted") throw new Error("Operating expense journal entry must be balanced");
    await tx.update(cashTransactionsTable).set({ journalEntryId: posting.journalEntryId }).where(eq(cashTransactionsTable.id, cash.id));
    await tx.update(operatingExpensesTable).set({ paymentDate: date, paymentAmount: amount, bankTransactionId: id, cashTransactionId: cash.id }).where(eq(operatingExpensesTable.id, expense.id));
    return { bankTransactionId: id, operatingExpenseId: expense.id, cashTransactionId: cash.id, journalEntryId: posting.journalEntryId };
  });
}