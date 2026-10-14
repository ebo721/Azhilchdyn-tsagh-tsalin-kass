import { Router, type IRouter } from "express";
import {
  CreateJournalEntryBody, CreateJournalEntryResponse, GetJournalEntryParams, GetJournalEntryResponse,
  ListJournalEntriesQueryParams, ListJournalEntriesResponse, UpdateJournalEntryBody, UpdateJournalEntryParams,
  UpdateJournalEntryResponse, VoidJournalEntryParams, VoidJournalEntryResponse, DeleteJournalEntryParams,
  GetJournalAccountLedgerParams, GetJournalAccountLedgerResponse, GetJournalTrialBalanceResponse,
  ListJournalReceivablesQueryParams, ListJournalReceivablesResponse, ListJournalPayablesQueryParams,
  ListJournalPayablesResponse, ListJournalSuppliersResponse,
  CreateEmployeeReceivableBody, CreateEmployeeReceivableResponse,
  CreateEmployeePayableResponse,
} from "@workspace/api-zod";
import { and, asc, desc, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { db, bankTransactionsTable, cashTransactionsTable, chartOfAccountsTable, journalEntriesTable, journalLinesTable, receivablesTable, receivableAllocationsTable, payablesTable, payableAllocationsTable, employeesTable, inventorySuppliersTable, type JournalEntry, type JournalLine } from "@workspace/db";
import { getStaffSession } from "../lib/hr-session.js";
import {
  JournalValidationError, postJournalEntry, voidJournalEntry,
} from "../lib/journal-posting.js";
import type { Tx } from "../lib/route-shared.js";

const router: IRouter = Router();

// Both employee balance forms use the same journal posting/allocation lifecycle.
function registerEmployeeBalance(kind: "receivable" | "payable") {
  return async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    const parsed = CreateEmployeeReceivableBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Ажилтан, огноо, дүн, тайлбар болон харгалзах дансыг зөв оруулна уу" });
    try {
      const input = parsed.data;
      if (Number(input.amount.toFixed(2)) !== input.amount || !input.description.trim()) {
        throw new JournalValidationError("Дүнг хоёр хүртэл бутархай оронтой, тайлбарыг хоосон биш оруулна уу");
      }
      const date = journalDate(input.date);
      const session = await getStaffSession(req);
      if (!session || (session.role !== "admin" && session.role !== "accountant")) {
        return res.status(403).json({ error: "Зөвхөн админ, нягтлан бүртгэл үүсгэнэ" });
      }
      const record = await db.transaction(async tx => {
        const [employee] = await tx.select({ id: employeesTable.id, name: employeesTable.name })
          .from(employeesTable).where(and(eq(employeesTable.id, input.employeeId), eq(employeesTable.status, "active"))).for("share");
        if (!employee) throw new JournalValidationError("Идэвхтэй ажилтан сонгоно уу");
        const code = kind === "receivable" ? "1200" : "2000";
        const [account] = await tx.select().from(chartOfAccountsTable)
          .where(and(eq(chartOfAccountsTable.code, code), eq(chartOfAccountsTable.isActive, true))).for("share");
        if (!account) throw new JournalValidationError(`${code} данс идэвхгүй эсвэл олдсонгүй`);
        const [counter] = await tx.select().from(chartOfAccountsTable)
          .where(and(eq(chartOfAccountsTable.id, input.counterAccountId), eq(chartOfAccountsTable.isActive, true))).for("share");
        if (!counter || counter.code === "1200" || counter.code === "2000") {
          throw new JournalValidationError("Авлага, өглөгийн данснаас өөр идэвхтэй харгалзах данс сонгоно уу");
        }
        const description = input.description.trim();
        const receivable = kind === "receivable";
        const result = await postJournalEntry(tx, {
          date, description, sourceType: "manual", sourceId: null, createdBy: session.id,
          lines: [
            { accountId: account.id, debit: receivable ? input.amount : 0, credit: receivable ? 0 : input.amount,
              memo: description, allocation: { kind: "create", partyType: "employee", employeeId: employee.id } },
            { accountId: counter.id, debit: receivable ? 0 : input.amount, credit: receivable ? input.amount : 0, memo: description },
          ],
        });
        if (result.status !== "posted") throw new JournalValidationError("Журнал тэнцэж батлагдсангүй");
        if (receivable) {
          const [row] = await tx.select({ record: receivablesTable }).from(receivablesTable)
            .innerJoin(journalLinesTable, eq(journalLinesTable.id, receivablesTable.originJournalLineId))
            .where(eq(journalLinesTable.journalEntryId, result.journalEntryId));
          return CreateEmployeeReceivableResponse.parse({
            ...row.record, partyType: "employee", partyId: employee.id, partyLabel: employee.name, date, description,
          });
        }
        const [row] = await tx.select().from(payablesTable).where(eq(payablesTable.journalEntryId, result.journalEntryId));
        return CreateEmployeePayableResponse.parse({ ...row, partyLabel: employee.name, date });
      });
      return res.status(201).json(record);
    } catch (error) {
      if (error instanceof JournalValidationError) return res.status(400).json({ error: error.message });
      return next(error);
    }
  };
}
router.post("/journal/receivables", registerEmployeeBalance("receivable"));
router.post("/journal/payables", registerEmployeeBalance("payable"));

async function isFixedAssetJournal(tx: Tx, entry: { sourceType: string; sourceId: number | null }): Promise<boolean> {
  if (entry.sourceType === "fixed_asset") return true;
  if (entry.sourceType !== "reversal" || entry.sourceId === null) return false;
  const [original] = await tx.select({ sourceType: journalEntriesTable.sourceType })
    .from(journalEntriesTable).where(eq(journalEntriesTable.id, entry.sourceId));
  return original?.sourceType === "fixed_asset";
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Invalid journal entry";
function journalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new JournalValidationError("Journal date must use YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new JournalValidationError("Journal date is not a valid calendar date");
  }
  return value;
}
type JournalEntryWithLines = JournalEntry & { lines: JournalLine[]; totalDebit: number; totalCredit: number };
function entryWithLines(entry: JournalEntry, lines: JournalLine[]): JournalEntryWithLines {
  return {
    ...entry,
    lines,
    totalDebit: lines.reduce((sum, line) => sum + Number(line.debit), 0),
    totalCredit: lines.reduce((sum, line) => sum + Number(line.credit), 0),
  };
}
async function loadEntry(id: number): Promise<JournalEntryWithLines | null> {
  const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, id));
  if (!entry) return null;
  const lines = await db.select().from(journalLinesTable).where(eq(journalLinesTable.journalEntryId, id)).orderBy(journalLinesTable.id);
  return entryWithLines(entry, lines);
}

router.get("/journal/entries", async (req, res, next) => {
  try {
    const raw = ListJournalEntriesQueryParams.parse(req.query);
    const filters = [];
    if (raw.dateFrom) filters.push(gte(journalEntriesTable.date, journalDate(raw.dateFrom)));
    if (raw.dateTo) filters.push(lte(journalEntriesTable.date, journalDate(raw.dateTo)));
    if (raw.sourceType) filters.push(eq(journalEntriesTable.sourceType, raw.sourceType));
    if (raw.status) filters.push(eq(journalEntriesTable.status, raw.status));
    if (raw.accountId) {
      const ids = await db.select({ id: journalLinesTable.journalEntryId }).from(journalLinesTable).where(eq(journalLinesTable.accountId, raw.accountId));
      filters.push(inArray(journalEntriesTable.id, ids.map((row) => row.id)));
    }
    const rows = await db.select().from(journalEntriesTable).where(filters.length ? and(...filters) : undefined).orderBy(desc(journalEntriesTable.date), desc(journalEntriesTable.id));
    const totals = rows.length
      ? await db.select({
        journalEntryId: journalLinesTable.journalEntryId,
        totalDebit: sql<number>`coalesce(sum(${journalLinesTable.debit}), 0)::double precision`,
        totalCredit: sql<number>`coalesce(sum(${journalLinesTable.credit}), 0)::double precision`,
      }).from(journalLinesTable)
        .where(inArray(journalLinesTable.journalEntryId, rows.map((row) => row.id)))
        .groupBy(journalLinesTable.journalEntryId)
      : [];
    const totalByEntry = new Map(totals.map((total) => [total.journalEntryId, total]));
    res.json(ListJournalEntriesResponse.parse(rows.map((row) => ({
      ...row,
      totalDebit: Number(totalByEntry.get(row.id)?.totalDebit ?? 0),
      totalCredit: Number(totalByEntry.get(row.id)?.totalCredit ?? 0),
    }))));
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) return res.status(Number(error.status)).json({ error: errorMessage(error) });
    if (error instanceof JournalValidationError) return res.status(400).json({ error: error.message });
    return next(error);
  }
});

router.get("/journal/receivables", async (req, res, next) => {
  try {
    const { status = "open" } = ListJournalReceivablesQueryParams.parse(req.query);
    const filters = status === "all" ? undefined : eq(receivablesTable.status, status);
    const rows = await db.select({
      id: receivablesTable.id,
      originJournalEntryId: receivablesTable.originJournalEntryId,
      originJournalLineId: receivablesTable.originJournalLineId,
      employeeId: receivablesTable.employeeId,
      supplierId: receivablesTable.supplierId,
      originalAmount: receivablesTable.originalAmount,
      openAmount: receivablesTable.openAmount,
      status: receivablesTable.status,
      createdAt: receivablesTable.createdAt,
      date: journalEntriesTable.date,
      description: sql<string>`coalesce(${journalLinesTable.memo}, ${journalEntriesTable.description})`,
      employeeName: employeesTable.name,
      supplierName: inventorySuppliersTable.name,
    }).from(receivablesTable)
      .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, receivablesTable.originJournalEntryId))
      .innerJoin(journalLinesTable, eq(journalLinesTable.id, receivablesTable.originJournalLineId))
      .leftJoin(employeesTable, eq(employeesTable.id, receivablesTable.employeeId))
      .leftJoin(inventorySuppliersTable, eq(inventorySuppliersTable.id, receivablesTable.supplierId))
      .where(filters).orderBy(desc(receivablesTable.createdAt));
    return res.json(ListJournalReceivablesResponse.parse(rows.map((row) => ({
      ...row,
      partyType: row.employeeId ? "employee" : "supplier",
      partyId: row.employeeId ?? row.supplierId!,
      partyLabel: row.employeeName ?? row.supplierName!,
    }))));
  } catch (error) { return next(error); }
});

router.get("/journal/payables", async (req, res, next) => {
  try {
    const query = ListJournalPayablesQueryParams.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Invalid payable status" });
    const { status = "open" } = query.data;
    const rows = await db.select({
      id: payablesTable.id,
      journalEntryId: payablesTable.journalEntryId,
      description: payablesTable.description,
      partyType: payablesTable.partyType,
      partyId: payablesTable.partyId,
      originalAmount: payablesTable.originalAmount,
      remainingBalance: payablesTable.remainingBalance,
      status: payablesTable.status,
      createdAt: payablesTable.createdAt,
      date: journalEntriesTable.date,
      employeeName: employeesTable.name,
      supplierName: inventorySuppliersTable.name,
    }).from(payablesTable)
      .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, payablesTable.journalEntryId))
      .leftJoin(employeesTable, and(eq(payablesTable.partyType, "employee"), eq(employeesTable.id, payablesTable.partyId)))
      .leftJoin(inventorySuppliersTable, and(eq(payablesTable.partyType, "supplier"), eq(inventorySuppliersTable.id, payablesTable.partyId)))
      .where(status === "all" ? undefined : eq(payablesTable.status, status))
      .orderBy(desc(payablesTable.createdAt), desc(payablesTable.id));
    return res.json(ListJournalPayablesResponse.parse(rows.map((row) => ({
      id: row.id,
      journalEntryId: row.journalEntryId,
      description: row.description,
      partyType: row.partyType,
      partyId: row.partyId,
      partyLabel: row.employeeName ?? row.supplierName
        ?? `${row.partyType === "employee" ? "Ажилтан" : "Нийлүүлэгч"} #${row.partyId} (устгагдсан)`,
      originalAmount: row.originalAmount,
      remainingBalance: row.remainingBalance,
      status: row.status,
      createdAt: row.createdAt,
      date: row.date,
    }))));
  } catch (error) { return next(error); }
});

router.get("/journal/suppliers", async (_req, res, next) => {
  try {
    const rows = await db.select({ id: inventorySuppliersTable.id, name: inventorySuppliersTable.name })
      .from(inventorySuppliersTable).orderBy(asc(inventorySuppliersTable.name));
    return res.json(ListJournalSuppliersResponse.parse(rows));
  } catch (error) { return next(error); }
});

router.get("/journal/entries/:id", async (req, res, next) => {
  try {
    const { id } = GetJournalEntryParams.parse(req.params);
    const result = await loadEntry(id);
    if (!result) return res.status(404).json({ error: "Journal entry not found" });
    return res.json(GetJournalEntryResponse.parse(result));
  } catch (error) { return next(error); }
});

router.post("/journal/entries", async (req, res, next) => {
  try {
    const body = CreateJournalEntryBody.parse(req.body);
    const session = await getStaffSession(req);
    const result = await db.transaction((tx) => postJournalEntry(tx, {
      date: journalDate(body.date), description: body.description, sourceType: "manual", sourceId: null,
      createdBy: session?.id ?? null, lines: body.lines,
    }));
    const entry = await loadEntry(result.journalEntryId);
    return res.status(201).json(CreateJournalEntryResponse.parse(entry));
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) return res.status(Number(error.status)).json({ error: errorMessage(error) });
    if (error instanceof JournalValidationError) return res.status(400).json({ error: error.message });
    return next(error);
  }
});

router.put("/journal/entries/:id", async (req, res, next) => {
  try {
    const { id } = UpdateJournalEntryParams.parse(req.params);
    const body = UpdateJournalEntryBody.parse(req.body);
    await db.transaction(async (tx) => {
      const [entry] = await tx.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, id)).for("update");
      if (!entry) throw Object.assign(new Error("Journal entry not found"), { status: 404 });
      if (entry.status !== "draft") throw Object.assign(new Error("Only draft journal entries can be updated"), { status: 409 });
      return postJournalEntry(tx, {
        journalEntryId: id,
        date: entry.date,
        description: entry.description,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        createdBy: entry.createdBy,
        lines: body.lines,
      });
    });
    const entry = await loadEntry(id);
    return res.json(UpdateJournalEntryResponse.parse(entry));
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) return res.status(Number(error.status)).json({ error: errorMessage(error) });
    if (error instanceof JournalValidationError) return res.status(400).json({ error: error.message });
    return next(error);
  }
});

router.delete("/journal/entries/:id", async (req, res, next) => {
  try {
    const { id } = DeleteJournalEntryParams.parse(req.params);
    const result = await db.transaction(async (tx) => {
      const [entry] = await tx.select({
        id: journalEntriesTable.id,
        sourceType: journalEntriesTable.sourceType,
        sourceId: journalEntriesTable.sourceId,
      })
        .from(journalEntriesTable)
        .where(eq(journalEntriesTable.id, id))
        .for("update");
      if (!entry) return "missing" as const;
      if (await isFixedAssetJournal(tx, entry)) return "fixed_asset_owned" as const;
      const [link] = await tx.select({ linked: sql<boolean>`
        EXISTS (SELECT 1 FROM ${receivablesTable} WHERE ${receivablesTable.originJournalEntryId} = ${id})
        OR EXISTS (SELECT 1 FROM ${receivableAllocationsTable} WHERE ${receivableAllocationsTable.settlementJournalEntryId} = ${id})
        OR EXISTS (SELECT 1 FROM ${payablesTable} WHERE ${payablesTable.journalEntryId} = ${id})
        OR EXISTS (SELECT 1 FROM ${payableAllocationsTable} WHERE ${payableAllocationsTable.settlementJournalEntryId} = ${id})
      ` }).from(journalEntriesTable).where(eq(journalEntriesTable.id, id));
      if (link.linked) return "allocation_linked" as const;
      await tx.delete(journalEntriesTable).where(eq(journalEntriesTable.id, id));
      return "deleted" as const;
    });
    if (result === "missing") return res.status(404).json({ error: "Journal entry not found" });
    if (result === "fixed_asset_owned") {
      return res.status(409).json({ error: "Эд хөрөнгийн журналыг шууд устгахгүй. Эд хөрөнгийн бүртгэлээс засна уу" });
    }
    if (result === "allocation_linked") {
      return res.status(409).json({ error: "Авлага эсвэл өглөгтэй холбоотой журналыг шууд устгах боломжгүй" });
    }
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

router.post("/journal/entries/:id/void", async (req, res, next) => {
  try {
    const { id } = VoidJournalEntryParams.parse(req.params);
    const [[bankOwner], [cashOwner]] = await Promise.all([
      db.select({ id: bankTransactionsTable.id }).from(bankTransactionsTable).where(eq(bankTransactionsTable.journalEntryId, id)).limit(1),
      db.select({ id: cashTransactionsTable.id }).from(cashTransactionsTable).where(eq(cashTransactionsTable.journalEntryId, id)).limit(1),
    ]);
    if (bankOwner || cashOwner) {
      return res.status(409).json({ error: "Энэ журнал банк эсвэл кассын гүйлгээтэй холбоотой тул эх үүсвэр цэснээс өөрчилнө үү" });
    }
    const session = await getStaffSession(req);
    const result = await db.transaction(async (tx) => {
      const [entry] = await tx.select({
        sourceType: journalEntriesTable.sourceType,
        sourceId: journalEntriesTable.sourceId,
      }).from(journalEntriesTable).where(eq(journalEntriesTable.id, id)).for("update");
      if (entry && await isFixedAssetJournal(tx, entry)) return "fixed_asset_owned" as const;
      return voidJournalEntry(tx, { journalEntryId: id, voidedBy: session?.id ?? null });
    });
    if (result === "fixed_asset_owned") {
      return res.status(409).json({ error: "Эд хөрөнгийн журналыг шууд буцаахгүй. Эд хөрөнгийн бүртгэлээс засна уу" });
    }
    return res.json(VoidJournalEntryResponse.parse(result));
  } catch (error) {
    const message = errorMessage(error);
    if (error && typeof error === "object" && "status" in error) {
      return res.status(Number(error.status)).json({ error: message });
    }
    if (message === "Journal entry not found") return res.status(404).json({ error: message });
    if (message === "Only a posted journal entry can be voided") return res.status(409).json({ error: message });
    return next(error);
  }
});

const cents = (value: number) => BigInt(Math.round(value * 100));
const amount = (value: bigint) => Number(value) / 100;

router.get("/journal/accounts/:id/ledger", async (req, res, next) => {
  try {
    const { id } = GetJournalAccountLedgerParams.parse(req.params);
    const [account] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, id));
    if (!account) return res.status(404).json({ error: "Account not found" });
    const rows = await db.select({
      date: journalEntriesTable.date, journalEntryId: journalEntriesTable.id, lineId: journalLinesTable.id,
      debit: journalLinesTable.debit, credit: journalLinesTable.credit,
    }).from(journalLinesTable)
      .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.journalEntryId))
      .where(and(eq(journalLinesTable.accountId, id), inArray(journalEntriesTable.status, ["posted", "void"])))
      .orderBy(asc(journalEntriesTable.date), asc(journalEntriesTable.id), asc(journalLinesTable.id));
    const grouped = new Map<number, { date: string; journalEntryId: number; debit: bigint; credit: bigint }>();
    for (const row of rows) {
      const current = grouped.get(row.journalEntryId);
      if (current) {
        current.debit += cents(row.debit);
        current.credit += cents(row.credit);
      } else grouped.set(row.journalEntryId, {
        date: row.date, journalEntryId: row.journalEntryId, debit: cents(row.debit), credit: cents(row.credit),
      });
    }
    let running = 0n;
    const entries = [...grouped.values()].map((row) => {
      running += account.normalBalance === "credit" ? row.credit - row.debit : row.debit - row.credit;
      return { date: row.date, journalEntryId: row.journalEntryId, debit: amount(row.debit), credit: amount(row.credit), balance: amount(running) };
    });
    return res.json(GetJournalAccountLedgerResponse.parse({
      accountId: id, code: account.code, name: account.name, normalBalance: account.normalBalance, entries,
    }));
  } catch (error) { return next(error); }
});

router.get("/journal/trial-balance", async (_req, res, next) => {
  try {
    const rows = await db.select({
      accountId: chartOfAccountsTable.id, code: chartOfAccountsTable.code, name: chartOfAccountsTable.name,
      normalBalance: chartOfAccountsTable.normalBalance, debit: journalLinesTable.debit, credit: journalLinesTable.credit,
    }).from(journalLinesTable)
      .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.journalEntryId))
      .innerJoin(chartOfAccountsTable, eq(chartOfAccountsTable.id, journalLinesTable.accountId))
      .where(inArray(journalEntriesTable.status, ["posted", "void"]));
    const totals = new Map<number, { accountId: number; code: string; name: string; normalBalance: string; debit: bigint; credit: bigint }>();
    for (const row of rows) {
      const current = totals.get(row.accountId) ?? {
        accountId: row.accountId, code: row.code, name: row.name, normalBalance: row.normalBalance, debit: 0n, credit: 0n,
      };
      current.debit += cents(row.debit); current.credit += cents(row.credit); totals.set(row.accountId, current);
    }
    const accountTotals = [...totals.values()].sort((a, b) => a.accountId - b.accountId);
    const totalDebit = accountTotals.reduce((sum, row) => sum + row.debit, 0n);
    const totalCredit = accountTotals.reduce((sum, row) => sum + row.credit, 0n);
    const accounts = accountTotals.map((row) => ({
      accountId: row.accountId, code: row.code, name: row.name, normalBalance: row.normalBalance,
      debit: amount(row.debit), credit: amount(row.credit),
      balance: amount(row.normalBalance === "credit" ? row.credit - row.debit : row.debit - row.credit),
    }));
    return res.json(GetJournalTrialBalanceResponse.parse({
      balanced: totalDebit === totalCredit, totalDebit: amount(totalDebit), totalCredit: amount(totalCredit), accounts,
    }));
  } catch (error) { return next(error); }
});

export default router;