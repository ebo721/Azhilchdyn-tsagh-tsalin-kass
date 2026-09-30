import { Router, type IRouter } from "express";
import {
  CreateFixedAssetBody,
  CreateFixedAssetResponse,
  UpdateFixedAssetBody,
  UpdateFixedAssetParams,
  UpdateFixedAssetResponse,
  DeleteFixedAssetParams,
  ListFixedAssetsResponse,
  ListFixedAssetBankSuggestionsQueryParams,
  ListFixedAssetBankSuggestionsResponse,
} from "@workspace/api-zod";
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import {
  bankTransactionsTable,
  cashClosuresTable,
  cashTransactionsTable,
  chartOfAccountsTable,
  db,
  fixedAssetsTable,
} from "@workspace/db";
import { cashAccountForCategory } from "../lib/cash-account.js";
import { bankSuggestionScore } from "../lib/bank-suggestion-score.js";
import { postJournalEntry, voidJournalEntry } from "../lib/journal-posting.js";
import { isCashDateClosed, isValidCalendarDate, money, type Tx } from "../lib/route-shared.js";

const router: IRouter = Router();

async function postFixedAssetJournal(
  tx: Tx,
  input: {
    assetId: number;
    date: string;
    description: string;
    amount: number;
    settlementAccountCode?: "1000" | "1010";
  },
) {
  const settlementAccountCode = input.settlementAccountCode ?? "1000";
  const [fixedAssetAccount] = await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.code, "1800"),
    eq(chartOfAccountsTable.type, "asset"),
    eq(chartOfAccountsTable.normalBalance, "debit"),
    eq(chartOfAccountsTable.isActive, true),
  ));
  const [settlementAccount] = await tx.select().from(chartOfAccountsTable).where(and(
    eq(chartOfAccountsTable.code, settlementAccountCode),
    eq(chartOfAccountsTable.type, "asset"),
    eq(chartOfAccountsTable.normalBalance, "debit"),
    eq(chartOfAccountsTable.isActive, true),
  ));
  if (!fixedAssetAccount) throw new Error("Fixed asset account 1800 is missing or inactive");
  if (!settlementAccount) throw new Error(`Settlement account ${settlementAccountCode} is missing or inactive`);
  const result = await postJournalEntry(tx, {
    date: input.date,
    description: input.description,
    sourceType: "fixed_asset",
    sourceId: input.assetId,
    createdBy: null,
    lines: [
      { accountId: fixedAssetAccount.id, debit: input.amount, credit: 0 },
      { accountId: settlementAccount.id, debit: 0, credit: input.amount },
    ],
  });
  if (result.status !== "posted") throw new Error("Fixed asset journal entry must be balanced");
  return result.journalEntryId;
}



router.get("/fixed-assets", async (_req, res, next) => {
  try {
    const [rows, purchaseCashRows] = await Promise.all([
      db.select().from(fixedAssetsTable).orderBy(desc(fixedAssetsTable.date), desc(fixedAssetsTable.id)),
      db.select({
        sourceKey: cashTransactionsTable.sourceKey,
        bankTransactionId: cashTransactionsTable.bankTransactionId,
      }).from(cashTransactionsTable).where(eq(cashTransactionsTable.sourceType, "fixed_asset_purchase")),
    ]);
    const bankTransactionBySourceKey = new Map(
      purchaseCashRows.map((cash) => [cash.sourceKey, cash.bankTransactionId]),
    );
    res.json(ListFixedAssetsResponse.parse(rows.map((asset) => ({
      ...asset,
      unitPrice: Number(asset.unitPrice),
      quantity: Number(asset.quantity),
      totalAmount: money(Number(asset.unitPrice) * Number(asset.quantity)),
      bankTransactionId: bankTransactionBySourceKey.get(`fixed-asset:${asset.id}`) ?? null,
      createdAt: asset.createdAt.toISOString(),
    }))));
  } catch (error) {
    next(error);
  }
});

router.get("/fixed-assets/bank-suggestions", async (req, res, next) => {
  try {
    const { date, amount, description } = ListFixedAssetBankSuggestionsQueryParams.parse(req.query);
    if (!isValidCalendarDate(date)) {
      res.status(400).json({ error: "Хуанлийн огноо буруу байна" });
      return;
    }
    if (await isCashDateClosed(date)) {
      res.json(ListFixedAssetBankSuggestionsResponse.parse([]));
      return;
    }
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);
    const candidates = await db.select({
      bank: bankTransactionsTable,
      accountCode: chartOfAccountsTable.code,
    }).from(bankTransactionsTable)
      .leftJoin(chartOfAccountsTable, eq(bankTransactionsTable.accountId, chartOfAccountsTable.id))
      .where(and(
        eq(bankTransactionsTable.type, "expense"),
        eq(bankTransactionsTable.amount, money(amount)),
        isNull(bankTransactionsTable.cashTransactionId),
        isNull(bankTransactionsTable.transferredAt),
        isNull(bankTransactionsTable.unclearAt),
        isNull(bankTransactionsTable.journalEntryId),
        gte(bankTransactionsTable.transactionAt, start),
        lte(bankTransactionsTable.transactionAt, end),
      ));
    const suggestions = candidates
      .filter(({ accountCode }) => accountCode !== "1500" && accountCode !== "1510")
      .map(({ bank }) => ({ bank, score: bankSuggestionScore(bank, { date, amount, description }) }))
      .sort((a, b) => b.score - a.score || a.bank.id - b.bank.id)
      .slice(0, 10)
      .map(({ bank, score }) => ({
        id: bank.id,
        transactionAt: bank.transactionAt.toISOString(),
        amount: Number(bank.amount),
        description: bank.description,
        score,
      }));
    res.json(ListFixedAssetBankSuggestionsResponse.parse(suggestions));
  } catch (error) {
    next(error);
  }
});

router.post("/fixed-assets", async (req, res, next) => {
  try {
    const input = CreateFixedAssetBody.parse(req.body);
    if (!isValidCalendarDate(input.date)) {
      res.status(400).json({ error: "Хуанлийн огноо буруу байна" });
      return;
    }
    const name = input.name.trim();
    if (!name) {
      res.status(400).json({ error: "Хөрөнгийн нэр хоосон байж болохгүй" });
      return;
    }
    if (money(input.unitPrice) !== input.unitPrice) {
      res.status(400).json({ error: "Хөрөнгийн нэгж үнэ 2 орны нарийвчлалтай байх ёстой" });
      return;
    }
    if (input.purchased && await isCashDateClosed(input.date)) {
      res.status(409).json({ error: "Өндөрлөсөн өдөр худалдан авсан хөрөнгө бүртгэх боломжгүй" });
      return;
    }
    const totalAmount = money(input.unitPrice * input.quantity);
    const asset = await db.transaction(async (tx) => {
      const [created] = await tx.insert(fixedAssetsTable).values({
        name,
        unitPrice: input.unitPrice,
        quantity: input.quantity,
        date: input.date,
        purchased: input.purchased,
      }).returning();
      if (input.purchased) {
        const account = await cashAccountForCategory(tx, "Эд хөрөнгө");
        const [cash] = await tx.insert(cashTransactionsTable).values({
          type: "expense",
          category: "Эд хөрөнгө",
          accountId: account?.id ?? null,
          description: `${name} (${input.quantity} ширхэг)`,
          amount: totalAmount,
          date: input.date,
          sourceType: "fixed_asset_purchase",
          sourceKey: `fixed-asset:${created.id}`,
        }).returning({ id: cashTransactionsTable.id });
        const journalEntryId = await postFixedAssetJournal(tx, {
          assetId: created.id,
          date: input.date,
          description: `${name} (${input.quantity} ширхэг)`,
          amount: totalAmount,
        });
        await tx.update(cashTransactionsTable)
          .set({ journalEntryId })
          .where(eq(cashTransactionsTable.id, cash.id));
      }
      return created;
    });
    res.status(201).json(CreateFixedAssetResponse.parse({
      ...asset,
      unitPrice: Number(asset.unitPrice),
      quantity: Number(asset.quantity),
      totalAmount,
      bankTransactionId: null,
      createdAt: asset.createdAt.toISOString(),
    }));
  } catch (error) {
    next(error);
  }
});

router.put("/fixed-assets/:id", async (req, res, next) => {
  try {
    const { id } = UpdateFixedAssetParams.parse(req.params);
    const input = UpdateFixedAssetBody.parse(req.body);
    if (!isValidCalendarDate(input.date)) {
      res.status(400).json({ error: "Хуанлийн огноо буруу байна" });
      return;
    }
    const name = input.name.trim();
    if (!name) {
      res.status(400).json({ error: "Хөрөнгийн нэр хоосон байж болохгүй" });
      return;
    }
    if (money(input.unitPrice) !== input.unitPrice) {
      res.status(400).json({ error: "Хөрөнгийн нэгж үнэ 2 орны нарийвчлалтай байх ёстой" });
      return;
    }
    const [existing] = await db.select().from(fixedAssetsTable).where(eq(fixedAssetsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Эд хөрөнгө олдсонгүй" });
      return;
    }
    const totalAmount = money(input.unitPrice * input.quantity);
    const result = await db.transaction(async (tx) => {
      const [lockedExisting] = await tx.select().from(fixedAssetsTable)
        .where(eq(fixedAssetsTable.id, id))
        .for("update");
      if (!lockedExisting) return { kind: "missing" as const };
      const affectedDates = new Set<string>();
      if (lockedExisting.purchased) affectedDates.add(lockedExisting.date);
      if (input.purchased) affectedDates.add(input.date);
      if (affectedDates.size) {
        const closures = await tx.select({ date: cashClosuresTable.date }).from(cashClosuresTable);
        if (closures.some(({ date }) => affectedDates.has(date))) return { kind: "cash_closed" as const };
      }

      const sourceKey = `fixed-asset:${id}`;
      const [oldCash] = await tx.select().from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "fixed_asset_purchase"),
        eq(cashTransactionsTable.sourceKey, sourceKey),
      )).for("update");
      let linkedBank: typeof bankTransactionsTable.$inferSelect | null = null;
      if (oldCash?.bankTransactionId !== null && oldCash?.bankTransactionId !== undefined) {
        [linkedBank] = await tx.select().from(bankTransactionsTable)
          .where(eq(bankTransactionsTable.id, oldCash.bankTransactionId))
          .for("update");
        if (!linkedBank || linkedBank.cashTransactionId !== oldCash.id || !input.purchased) {
          return { kind: "bank_linked_conflict" as const };
        }
        const bankDate = linkedBank.transactionAt.toISOString().slice(0, 10);
        if (input.date !== bankDate || money(Number(linkedBank.amount)) !== totalAmount) {
          return { kind: "bank_linked_conflict" as const };
        }
      }
      const oldDescription = oldCash?.description;
      const oldAmount = oldCash ? Number(oldCash.amount) : null;
      const oldDate = oldCash?.date;
      const [updated] = await tx.update(fixedAssetsTable).set({
        name,
        unitPrice: input.unitPrice,
        quantity: input.quantity,
        date: input.date,
        purchased: input.purchased,
      }).where(eq(fixedAssetsTable.id, id)).returning();
      if (input.purchased) {
        const account = await cashAccountForCategory(tx, "Эд хөрөнгө");
        const [cash] = await tx.insert(cashTransactionsTable).values({
          type: "expense",
          category: "Эд хөрөнгө",
          accountId: account?.id ?? null,
          description: `${name} (${input.quantity} ширхэг)`,
          amount: totalAmount,
          date: input.date,
          sourceType: "fixed_asset_purchase",
          sourceKey,
        }).onConflictDoUpdate({
          target: [cashTransactionsTable.sourceType, cashTransactionsTable.sourceKey],
          set: {
            accountId: account?.id ?? null,
            description: `${name} (${input.quantity} ширхэг)`,
            amount: totalAmount,
            date: input.date,
          },
        }).returning();
        const description = `${name} (${input.quantity} ширхэг)`;
        const changed = !oldCash
          || oldAmount !== totalAmount
          || oldDate !== input.date
          || oldDescription !== description;
        if (!lockedExisting.purchased || (changed && (cash.journalEntryId !== null || linkedBank !== null))) {
          if (cash.journalEntryId !== null && changed) {
            await voidJournalEntry(tx, { journalEntryId: cash.journalEntryId, voidedBy: null });
          }
          const journalEntryId = await postFixedAssetJournal(tx, {
            assetId: id,
            date: input.date,
            description,
            amount: totalAmount,
            settlementAccountCode: linkedBank ? "1010" : "1000",
          });
          await tx.update(cashTransactionsTable).set({ journalEntryId })
            .where(eq(cashTransactionsTable.id, cash.id));
        }
      } else {
        if (oldCash?.journalEntryId !== null && oldCash?.journalEntryId !== undefined) {
          await voidJournalEntry(tx, { journalEntryId: oldCash.journalEntryId, voidedBy: null });
        }
        await tx.delete(cashTransactionsTable).where(and(
          eq(cashTransactionsTable.sourceType, "fixed_asset_purchase"),
          eq(cashTransactionsTable.sourceKey, sourceKey),
        ));
      }
      return {
        kind: "updated" as const,
        asset: updated,
        bankTransactionId: oldCash?.bankTransactionId ?? null,
      };
    });
    if (result.kind === "missing") {
      res.status(404).json({ error: "Эд хөрөнгө олдсонгүй" });
      return;
    }
    if (result.kind === "cash_closed") {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн худалдан авсан хөрөнгийг засах боломжгүй" });
      return;
    }
    if (result.kind === "bank_linked_conflict") {
      res.status(409).json({ error: "Засварласан огноо, нийт дүн банкны гүйлгээтэй таарах ёстой" });
      return;
    }
    res.json(UpdateFixedAssetResponse.parse({
      ...result.asset,
      unitPrice: Number(result.asset.unitPrice),
      quantity: Number(result.asset.quantity),
      totalAmount,
      bankTransactionId: result.bankTransactionId,
      createdAt: result.asset.createdAt.toISOString(),
    }));
  } catch (error) {
    next(error);
  }
});

router.delete("/fixed-assets/:id", async (req, res, next) => {
  try {
    const { id } = DeleteFixedAssetParams.parse(req.params);
    const [existing] = await db.select().from(fixedAssetsTable).where(eq(fixedAssetsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Эд хөрөнгө олдсонгүй" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [lockedExisting] = await tx.select().from(fixedAssetsTable)
        .where(eq(fixedAssetsTable.id, id))
        .for("update");
      if (!lockedExisting) return "missing" as const;
      if (lockedExisting.purchased) {
        const [closure] = await tx.select({ id: cashClosuresTable.id })
          .from(cashClosuresTable)
          .where(eq(cashClosuresTable.date, lockedExisting.date));
        if (closure) return "cash_closed" as const;
      }
      const [cash] = await tx.select().from(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "fixed_asset_purchase"),
        eq(cashTransactionsTable.sourceKey, `fixed-asset:${id}`),
      )).for("update");
      if (cash?.bankTransactionId !== null && cash?.bankTransactionId !== undefined) {
        return "bank_linked" as const;
      }
      if (cash?.journalEntryId !== null && cash?.journalEntryId !== undefined) {
        await voidJournalEntry(tx, { journalEntryId: cash.journalEntryId, voidedBy: null });
      }
      await tx.delete(cashTransactionsTable).where(and(
        eq(cashTransactionsTable.sourceType, "fixed_asset_purchase"),
        eq(cashTransactionsTable.sourceKey, `fixed-asset:${id}`),
      ));
      await tx.delete(fixedAssetsTable).where(eq(fixedAssetsTable.id, id));
      return "deleted" as const;
    });
    if (result === "missing") {
      res.status(404).json({ error: "Эд хөрөнгө олдсонгүй" });
      return;
    }
    if (result === "cash_closed") {
      res.status(409).json({ error: "Өндөрлөсөн өдрийн худалдан авсан хөрөнгийг устгах боломжгүй" });
      return;
    }
    if (result === "bank_linked") {
      res.status(409).json({ error: "Банкны гүйлгээтэй холбогдсон эд хөрөнгийг устгах боломжгүй" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;