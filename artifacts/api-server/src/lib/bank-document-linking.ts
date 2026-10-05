import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  bankTransactionsTable, cashClosuresTable, cashTransactionsTable,
  chartOfAccountsTable, db, fixedAssetsTable, inventoryItemsTable, inventoryPurchaseItemsTable,
  inventoryPurchasePaymentGroupMembersTable, inventoryPurchasePaymentGroupsTable,
  inventoryPurchasesTable, inventorySuppliersTable, journalEntriesTable, journalLinesTable, operatingExpensesTable,
} from "@workspace/db";
import { cashAccountForCategory } from "./cash-account.js";
import { checkBankLinkEligibility } from "./bank-link-eligibility.js";
import { lockCashDate } from "./cash-date-lock.js";
import { inventoryMaterialLabel, inventoryPurchaseAccount, money } from "./route-shared.js";
import { postJournalEntry, voidJournalEntry } from "./journal-posting.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type PurchaseInput = { inventoryPurchaseId: number } | {
  materialType: "food" | "supply"; supplierName: string; hasReceipt: boolean; date: string;
  items: Array<{ inventoryItemId?: number; name: string; category: string; unit: string; quantity: number; unitPrice: number }>;
};
type ExpenseInput = { operatingExpenseId: number } | { description: string; accountId: number; date: string; amount: number };
type FixedAssetDetails = { name: string; unitPrice: number; quantity: number; date: string };
type FixedAssetInput = { fixedAssetId: number; assetUpdate?: FixedAssetDetails } | FixedAssetDetails;
export type LinkResult = { bankTransactionId: number; inventoryPurchaseId: number; cashTransactionId: number; journalEntryId: number }
  | { bankTransactionId: number; operatingExpenseId: number; cashTransactionId: number; journalEntryId: number }
  | { bankTransactionId: number; fixedAssetId: number; cashTransactionId: number; journalEntryId: number };
const cents = (value: number) => Math.round(value * 100);

export async function activePurchasePaymentGroup(tx: Tx, purchaseId: number) {
  const [row] = await tx.select({
    groupId: inventoryPurchasePaymentGroupsTable.id,
    bankTransactionId: inventoryPurchasePaymentGroupsTable.bankTransactionId,
  }).from(inventoryPurchasePaymentGroupMembersTable)
    .innerJoin(inventoryPurchasePaymentGroupsTable, eq(
      inventoryPurchasePaymentGroupsTable.id,
      inventoryPurchasePaymentGroupMembersTable.groupId,
    ))
    .where(and(
      eq(inventoryPurchasePaymentGroupMembersTable.purchaseId, purchaseId),
      eq(inventoryPurchasePaymentGroupsTable.status, "active"),
    )).limit(1);
  return row ?? null;
}

export async function linkBankPurchases(id: number, purchaseIds: number[]) {
  if (purchaseIds.length < 2 || new Set(purchaseIds).size !== purchaseIds.length) return "invalid_input";
  return db.transaction(async (tx) => {
    const ids = [...purchaseIds].sort((a, b) => a - b);
    // Existing one-purchase payment flows lock the purchase before claiming a
    // bank row. Keep that order and sort IDs so overlapping groups serialize.
    const purchases = await tx.select().from(inventoryPurchasesTable)
      .where(inArray(inventoryPurchasesTable.id, ids))
      .orderBy(inventoryPurchasesTable.id)
      .for("update");
    if (purchases.length !== ids.length) return "missing_purchase";
    const [bank] = await tx.select().from(bankTransactionsTable)
      .where(eq(bankTransactionsTable.id, id)).for("update");
    if (!bank) return "missing_bank";
    const eligibility = await checkBankLinkEligibility(tx, bank, "purchase");
    if (eligibility.issue) return eligibility.issue;
    if (eligibility.closed) return "closed";
    const date = bank.transactionAt.toISOString().slice(0, 10);
    const totalCents = purchases.reduce((sum, purchase) => sum + cents(Number(purchase.totalAmount)), 0);
    if (purchases.some((purchase) => purchase.paymentDate !== null || purchase.date > date)
      || totalCents !== cents(Number(bank.amount))) return "purchase_conflict";
    const materialTypes = new Set(purchases.map((purchase) => purchase.materialType));
    if (materialTypes.size !== 1) return "purchase_mixed_material_types";
    for (const purchase of purchases) {
      if (await activePurchasePaymentGroup(tx, purchase.id)) return "purchase_conflict";
      const [priorCash] = await tx.select({ id: cashTransactionsTable.id }).from(cashTransactionsTable)
        .where(and(
          eq(cashTransactionsTable.sourceType, "inventory_purchase"),
          eq(cashTransactionsTable.sourceKey, `purchase:${purchase.id}`),
        ));
      if (priorCash) return "purchase_conflict";
    }

    const accountByPurchase = new Map<number, number>();
    for (const purchase of purchases) {
      const canonical = await inventoryPurchaseAccount(tx, purchase.materialType);
      if (purchase.accountId !== canonical.id) return "purchase_conflict";
      const [account] = await tx.select().from(chartOfAccountsTable).where(and(
        eq(chartOfAccountsTable.id, purchase.accountId),
        eq(chartOfAccountsTable.isActive, true),
      ));
      if (!account) return "purchase_conflict";
      accountByPurchase.set(purchase.id, account.id);
    }
    const [settlement] = await tx.select().from(chartOfAccountsTable).where(and(
      eq(chartOfAccountsTable.code, "1010"),
      eq(chartOfAccountsTable.type, "asset"),
      eq(chartOfAccountsTable.isActive, true),
    ));
    if (!settlement) throw new Error("Inventory or bank account is missing or inactive");

    const amount = cents(Number(bank.amount)) / 100;
    const materialType = purchases[0].materialType;
    const cashAccount = await inventoryPurchaseAccount(tx, materialType);
    const category = inventoryMaterialLabel(materialType);
    const verifiedAt = new Date();
    const description = `${category}ын бүлэг худалдан авалт (${purchases.length})`;
    const [cash] = await tx.insert(cashTransactionsTable).values({
      type: "expense",
      category,
      accountId: cashAccount.id,
      description,
      amount,
      date,
      sourceType: "inventory_purchase_group",
      sourceKey: `bank-purchase-group:${id}`,
      bankTransactionId: id,
      bankVerifiedAt: verifiedAt,
    }).returning();
    const [claimed] = await tx.update(bankTransactionsTable)
      .set({ cashTransactionId: cash.id, transferredAt: verifiedAt })
      .where(and(
        eq(bankTransactionsTable.id, id),
        isNull(bankTransactionsTable.cashTransactionId),
        isNull(bankTransactionsTable.transferredAt),
      )).returning();
    if (!claimed) throw new Error("Bank transaction was claimed concurrently");

    const lines = purchases.map((purchase) => ({
      accountId: accountByPurchase.get(purchase.id)!,
      debit: cents(Number(purchase.totalAmount)) / 100,
      credit: 0,
      memo: purchase.documentName,
    }));
    lines.push({ accountId: settlement.id, debit: 0, credit: amount, memo: "Банкны гүйлгээ" });
    const posting = await postJournalEntry(tx, {
      date,
      description,
      sourceType: "inventory_purchase_group",
      sourceId: id,
      createdBy: null,
      lines,
    });
    if (posting.status !== "posted") throw new Error("Grouped inventory purchase journal entry must be balanced");
    await tx.update(cashTransactionsTable).set({ journalEntryId: posting.journalEntryId })
      .where(eq(cashTransactionsTable.id, cash.id));
    await tx.update(bankTransactionsTable).set({ journalEntryId: posting.journalEntryId })
      .where(eq(bankTransactionsTable.id, id));
    const [group] = await tx.insert(inventoryPurchasePaymentGroupsTable).values({
      bankTransactionId: id,
      cashTransactionId: cash.id,
      journalEntryId: posting.journalEntryId,
    }).returning({ id: inventoryPurchasePaymentGroupsTable.id });
    await tx.insert(inventoryPurchasePaymentGroupMembersTable).values(ids.map((purchaseId) => ({
      groupId: group.id,
      purchaseId,
    })));
    for (const purchase of purchases) {
      await tx.update(inventoryPurchasesTable).set({
        paymentDate: date,
        paymentAmount: cents(Number(purchase.totalAmount)) / 100,
      }).where(eq(inventoryPurchasesTable.id, purchase.id));
    }
    return {
      bankTransactionId: id,
      inventoryPurchaseIds: ids,
      cashTransactionId: cash.id,
      journalEntryId: posting.journalEntryId,
    };
  });
}

export async function cancelBankPurchaseGroup(id: number, cancelledBy: number | null) {
  return db.transaction(async (tx) => {
    const [groupRef] = await tx.select({ id: inventoryPurchasePaymentGroupsTable.id })
      .from(inventoryPurchasePaymentGroupsTable)
      .where(and(
        eq(inventoryPurchasePaymentGroupsTable.bankTransactionId, id),
        eq(inventoryPurchasePaymentGroupsTable.status, "active"),
      ));
    if (!groupRef) return "missing_group";
    const members = await tx.select({ purchaseId: inventoryPurchasePaymentGroupMembersTable.purchaseId })
      .from(inventoryPurchasePaymentGroupMembersTable)
      .where(eq(inventoryPurchasePaymentGroupMembersTable.groupId, groupRef.id))
      .orderBy(inventoryPurchasePaymentGroupMembersTable.purchaseId);
    const purchaseIds = members.map((member) => member.purchaseId);
    if (purchaseIds.length < 2 || new Set(purchaseIds).size !== purchaseIds.length) return "group_conflict";
    // Match the forward-link and single-payment lock order before touching the
    // bank claim so cancellation cannot deadlock against those workflows.
    const purchases = await tx.select().from(inventoryPurchasesTable)
      .where(inArray(inventoryPurchasesTable.id, purchaseIds))
      .orderBy(inventoryPurchasesTable.id)
      .for("update");
    if (purchases.length !== purchaseIds.length) return "group_conflict";
    const [bank] = await tx.select().from(bankTransactionsTable)
      .where(eq(bankTransactionsTable.id, id)).for("update");
    if (!bank) return "missing_bank";
    const [group] = await tx.select().from(inventoryPurchasePaymentGroupsTable)
      .where(eq(inventoryPurchasePaymentGroupsTable.id, groupRef.id)).for("update");
    if (!group || group.status !== "active" || group.bankTransactionId !== id) return "missing_group";
    const date = bank.transactionAt.toISOString().slice(0, 10);
    const [closed] = await tx.select({ id: cashClosuresTable.id }).from(cashClosuresTable)
      .where(eq(cashClosuresTable.date, date));
    if (closed) return "closed";
    if (bank.type !== "expense"
      || bank.unclearAt !== null
      || bank.cashTransactionId !== group.cashTransactionId
      || bank.journalEntryId !== group.journalEntryId
      || bank.transferredAt === null) return "group_conflict";
    const [cash] = group.cashTransactionId === null ? [] : await tx.select().from(cashTransactionsTable)
      .where(eq(cashTransactionsTable.id, group.cashTransactionId)).for("update");
    if (!cash
      || cash.bankTransactionId !== bank.id
      || cash.journalEntryId !== group.journalEntryId
      || cash.sourceType !== "inventory_purchase_group"
      || cash.sourceKey !== `bank-purchase-group:${id}`
      || cash.type !== "expense"
      || cash.date !== date
      || cash.bankVerifiedAt === null) return "group_conflict";
    const purchaseTotalCents = purchases.reduce((sum, purchase) => sum + cents(Number(purchase.totalAmount)), 0);
    if (purchases.some((purchase) => purchase.date > date
      || purchase.paymentDate !== date
      || purchase.paymentAmount === null
      || cents(Number(purchase.paymentAmount)) !== cents(Number(purchase.totalAmount)))
      || purchaseTotalCents !== cents(Number(bank.amount))
      || purchaseTotalCents !== cents(Number(cash.amount))) return "group_conflict";

    const expectedDebits: Array<{ accountId: number; amount: number }> = [];
    for (const purchase of purchases) {
      const canonicalAccount = await inventoryPurchaseAccount(tx, purchase.materialType);
      if (purchase.accountId !== canonicalAccount.id) return "group_conflict";
      expectedDebits.push({ accountId: canonicalAccount.id, amount: cents(Number(purchase.totalAmount)) });
    }
    const [journal] = await tx.select().from(journalEntriesTable)
      .where(eq(journalEntriesTable.id, group.journalEntryId))
      .for("update");
    if (!journal
      || journal.status !== "posted"
      || journal.sourceType !== "inventory_purchase_group"
      || journal.sourceId !== bank.id
      || journal.date !== date) return "group_conflict";
    const journalLines = await tx.select().from(journalLinesTable)
      .where(eq(journalLinesTable.journalEntryId, journal.id));
    const [bankAccount] = await tx.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable)
      .where(and(
        eq(chartOfAccountsTable.code, "1010"),
        eq(chartOfAccountsTable.type, "asset"),
      ));
    if (!bankAccount || journalLines.length !== purchases.length + 1) return "group_conflict";
    const actualDebits = journalLines
      .filter((line) => cents(Number(line.debit)) > 0 && cents(Number(line.credit)) === 0)
      .map((line) => ({ accountId: line.accountId, amount: cents(Number(line.debit)) }))
      .sort((left, right) => left.accountId - right.accountId || left.amount - right.amount);
    expectedDebits.sort((left, right) => left.accountId - right.accountId || left.amount - right.amount);
    if (JSON.stringify(actualDebits) !== JSON.stringify(expectedDebits)) return "group_conflict";
    const credits = journalLines.filter((line) => cents(Number(line.credit)) > 0 && cents(Number(line.debit)) === 0);
    if (credits.length !== 1
      || credits[0].accountId !== bankAccount.id
      || cents(Number(credits[0].credit)) !== purchaseTotalCents) return "group_conflict";
    await voidJournalEntry(tx, { journalEntryId: group.journalEntryId, voidedBy: cancelledBy });
    await tx.update(bankTransactionsTable).set({
      cashTransactionId: null,
      transferredAt: null,
      journalEntryId: null,
    }).where(eq(bankTransactionsTable.id, bank.id));
    await tx.update(inventoryPurchasePaymentGroupsTable).set({
      status: "cancelled",
      cancelledAt: new Date(),
    }).where(eq(inventoryPurchasePaymentGroupsTable.id, group.id));
    await tx.delete(cashTransactionsTable).where(eq(cashTransactionsTable.id, cash.id));
    await tx.update(inventoryPurchasesTable).set({
      paymentDate: null,
      paymentAmount: null,
    }).where(inArray(inventoryPurchasesTable.id, purchaseIds));
    return { bankTransactionId: id, inventoryPurchaseIds: purchaseIds, cancelled: true as const };
  });
}

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
    const eligibility = await checkBankLinkEligibility(tx, bank, "purchase");
    if (eligibility.issue) return eligibility.issue;
    if (eligibility.closed) return "closed";
    const date = bank.transactionAt.toISOString().slice(0, 10);
    if ("inventoryPurchaseId" in input) {
      if (purchase.paymentDate !== null || purchase.date > date || money(Number(purchase.totalAmount)) !== money(Number(bank.amount))) return "purchase_conflict";
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
    const eligibility = await checkBankLinkEligibility(tx, bank, "expense");
    if (eligibility.issue) return eligibility.issue;
    if (eligibility.closed) return "closed";
    const date = bank.transactionAt.toISOString().slice(0, 10);
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

export async function linkBankFixedAsset(id: number, input: FixedAssetInput): Promise<LinkResult | string> {
  return db.transaction(async (tx) => {
    const [snapshot] = await tx.select({ transactionAt: bankTransactionsTable.transactionAt })
      .from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
    if (!snapshot) return "missing_bank";
    const snapshotDate = snapshot.transactionAt.toISOString().slice(0, 10);
    const [previousCash] = "fixedAssetId" in input
      ? await tx.select({ date: cashTransactionsTable.date }).from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "fixed_asset_purchase"),
        eq(cashTransactionsTable.sourceKey, `fixed-asset:${input.fixedAssetId}`),
      ))
      : [];
    for (const cashDate of [...new Set([snapshotDate, ...(previousCash ? [String(previousCash.date)] : [])])].sort()) {
      await lockCashDate(tx, cashDate);
    }
    const [bank] = await tx.select().from(bankTransactionsTable)
      .where(eq(bankTransactionsTable.id, id))
      .for("update");
    if (!bank) return "missing_bank";
    if (bank.transactionAt.toISOString().slice(0, 10) !== snapshotDate) return "bank_resolved";
    const eligibility = await checkBankLinkEligibility(tx, bank, "fixed_asset");
    if (eligibility.issue) return eligibility.issue;
    if (eligibility.closed) return "closed";
    const date = bank.transactionAt.toISOString().slice(0, 10);
    const amount = money(Number(bank.amount));

    let asset: typeof fixedAssetsTable.$inferSelect;
    const assetUpdate = "fixedAssetId" in input ? input.assetUpdate : undefined;
    if ("fixedAssetId" in input) {
      [asset] = await tx.select().from(fixedAssetsTable)
        .where(eq(fixedAssetsTable.id, input.fixedAssetId))
        .for("update");
      if (!asset) return "missing_fixed_asset";
      if (assetUpdate && (!assetUpdate.name.trim() || money(assetUpdate.unitPrice) !== assetUpdate.unitPrice)) {
        return "invalid_fixed_asset";
      }
      if ((assetUpdate?.date ?? asset.date) !== date
        || money((assetUpdate?.unitPrice ?? Number(asset.unitPrice)) * (assetUpdate?.quantity ?? asset.quantity)) !== amount) {
        return "fixed_asset_conflict";
      }
    } else {
      const name = input.name.trim();
      if (money(input.unitPrice) !== input.unitPrice) return "invalid_unit_price";
      const total = money(input.unitPrice * input.quantity);
      if (!name || input.date !== date || total !== amount) return "bank_mismatch";
      [asset] = await tx.insert(fixedAssetsTable).values({
        name,
        unitPrice: money(input.unitPrice),
        quantity: input.quantity,
        date,
        purchased: true,
      }).returning();
    }

    const sourceKey = `fixed-asset:${asset.id}`;
    const [existingCash] = await tx.select().from(cashTransactionsTable).where(and(
      eq(cashTransactionsTable.sourceType, "fixed_asset_purchase"),
      eq(cashTransactionsTable.sourceKey, sourceKey),
    )).for("update");
    if ("fixedAssetId" in input && (existingCash?.date ?? null) !== (previousCash?.date ?? null)) {
      return "fixed_asset_conflict";
    }
    if (existingCash?.bankTransactionId && existingCash.bankTransactionId !== id) return "fixed_asset_conflict";
    if (existingCash) {
      const [oldDateClosed] = await tx.select({ date: cashClosuresTable.date }).from(cashClosuresTable)
        .where(eq(cashClosuresTable.date, String(existingCash.date)));
      if (oldDateClosed) return "closed";
    }

    const [fixedAssetAccount] = await tx.select().from(chartOfAccountsTable).where(and(
      eq(chartOfAccountsTable.code, "1800"),
      eq(chartOfAccountsTable.type, "asset"),
      eq(chartOfAccountsTable.isActive, true),
    ));
    const [bankAccount] = await tx.select().from(chartOfAccountsTable).where(and(
      eq(chartOfAccountsTable.code, "1010"),
      eq(chartOfAccountsTable.type, "asset"),
      eq(chartOfAccountsTable.isActive, true),
    ));
    if (!fixedAssetAccount || !bankAccount) throw new Error("Fixed asset or bank account is missing or inactive");

    if (assetUpdate) {
      [asset] = await tx.update(fixedAssetsTable).set({
        name: assetUpdate.name.trim(),
        unitPrice: money(assetUpdate.unitPrice),
        quantity: assetUpdate.quantity,
        date,
        purchased: true,
      }).where(eq(fixedAssetsTable.id, asset.id)).returning();
    }
    const description = `${asset.name} (${asset.quantity} ширхэг)`;
    const categoryAccount = await cashAccountForCategory(tx, "Эд хөрөнгө");
    let cash = existingCash;
    const verifiedAt = new Date();
    if (cash) {
      if (cash.journalEntryId) {
        await voidJournalEntry(tx, { journalEntryId: cash.journalEntryId, voidedBy: null });
      }
      [cash] = await tx.update(cashTransactionsTable).set({
        category: "Эд хөрөнгө",
        accountId: categoryAccount?.id ?? null,
        description,
        amount,
        date,
        bankTransactionId: id,
        bankVerifiedAt: verifiedAt,
      }).where(eq(cashTransactionsTable.id, cash.id)).returning();
    } else {
      [cash] = await tx.insert(cashTransactionsTable).values({
        type: "expense",
        category: "Эд хөрөнгө",
        accountId: categoryAccount?.id ?? null,
        description,
        amount,
        date,
        sourceType: "fixed_asset_purchase",
        sourceKey,
        bankTransactionId: id,
        bankVerifiedAt: verifiedAt,
      }).returning();
    }

    const [claimed] = await tx.update(bankTransactionsTable)
      .set({ accountId: fixedAssetAccount.id, cashTransactionId: cash.id, transferredAt: verifiedAt })
      .where(and(
        eq(bankTransactionsTable.id, id),
        isNull(bankTransactionsTable.cashTransactionId),
        isNull(bankTransactionsTable.transferredAt),
      ))
      .returning();
    if (!claimed) throw new Error("Bank transaction was claimed concurrently");

    const posting = await postJournalEntry(tx, {
      date,
      description,
      sourceType: "fixed_asset",
      sourceId: asset.id,
      createdBy: null,
      lines: [
        { accountId: fixedAssetAccount.id, debit: amount, credit: 0 },
        { accountId: bankAccount.id, debit: 0, credit: amount },
      ],
    });
    if (posting.status !== "posted") throw new Error("Fixed asset bank journal entry must be balanced");
    await tx.update(cashTransactionsTable)
      .set({ journalEntryId: posting.journalEntryId })
      .where(eq(cashTransactionsTable.id, cash.id));
    if (!asset.purchased) {
      await tx.update(fixedAssetsTable).set({ purchased: true }).where(eq(fixedAssetsTable.id, asset.id));
    }
    return {
      bankTransactionId: id,
      fixedAssetId: asset.id,
      cashTransactionId: cash.id,
      journalEntryId: posting.journalEntryId,
    };
  });
}