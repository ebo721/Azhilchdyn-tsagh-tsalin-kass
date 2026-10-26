import { eq, sql } from "drizzle-orm";
import { db, employeesTable, inventorySuppliersTable } from "@workspace/db";
import type { PartyLedger } from "@workspace/api-zod";
import type { Tx } from "./route-shared.js";
import { money } from "./date-utils.js";
import { readSavedPayroll, PayrollSnapshotMissingError } from "./payroll-attendance-snapshot.js";
import { PayrollBalancesNotReadyError } from "./payroll-balance-store.js";

export type PartyLedgerInput = { partyType: "employee" | "supplier"; partyId: number; from: string; to: string };
export function ledgerConclusion(balance: number): PartyLedger["conclusion"] {
  return money(balance) > 0 ? "receivable" : money(balance) < 0 ? "payable" : "balanced";
}

/**
 * No name/description inference: only persisted source-document and allocation IDs.
 * A void operation marks the original void AND creates a posted compensating entry.
 * Exclude that pair together; an unpaired reversal of a still-active entry remains.
 */
export async function readPartyLedger(input: PartyLedgerInput, connection?: Tx): Promise<PartyLedger> {
  const read = async (tx: Tx): Promise<PartyLedger> => {
    const { partyType, partyId, from, to } = input;
    const [party] = partyType === "employee"
      ? await tx.select({ id: employeesTable.id, name: employeesTable.name, account: employeesTable.bankAccountNumber })
        .from(employeesTable).where(eq(employeesTable.id, partyId))
      : await tx.select({ id: inventorySuppliersTable.id, name: inventorySuppliersTable.name, account: sql<string | null>`NULL` })
        .from(inventorySuppliersTable).where(eq(inventorySuppliersTable.id, partyId));
    if (!party) throw Object.assign(new Error("Ажилтан эсвэл харилцагч олдсонгүй"), { status: 404 });

    const result = await tx.execute(sql`
      WITH effective AS (
        SELECT e.*, CASE WHEN e.source_type = 'reversal' THEN original.id ELSE e.id END AS owner_id,
          CASE WHEN e.source_type = 'reversal' THEN original.source_type ELSE e.source_type END AS owner_type,
          CASE WHEN e.source_type = 'reversal' THEN original.source_id ELSE e.source_id END AS owner_source_id
        FROM journal_entries e
        LEFT JOIN journal_entries original ON e.source_type = 'reversal' AND original.id = e.source_id
        WHERE e.status = 'posted' AND e.voided_at IS NULL AND e.date <= ${to}::date
          AND (e.source_type <> 'reversal' OR
            (original.status = 'posted' AND original.voided_at IS NULL))
      ), line_parties AS (
        SELECT origin_journal_line_id AS line_id,
          CASE WHEN employee_id IS NOT NULL THEN 'employee' ELSE 'supplier' END AS party_type,
          COALESCE(employee_id, supplier_id)::bigint AS party_id FROM receivables
        UNION
        SELECT a.settlement_journal_line_id, CASE WHEN r.employee_id IS NOT NULL THEN 'employee' ELSE 'supplier' END,
          COALESCE(r.employee_id, r.supplier_id)::bigint
          FROM receivable_allocations a JOIN receivables r ON r.id = a.receivable_id
        UNION
        SELECT a.settlement_journal_line_id, p.party_type, p.party_id::bigint
          FROM payable_allocations a JOIN payables p ON p.id = a.payable_id
        UNION
        SELECT l.id, l.allocation->>'partyType',
          CASE WHEN l.allocation->>'partyType' = 'employee'
            THEN (l.allocation->>'employeeId')::bigint ELSE (l.allocation->>'supplierId')::bigint END
          FROM journal_lines l JOIN chart_of_accounts c ON c.id = l.account_id
          WHERE c.code IN ('1200','2000') AND l.allocation->>'kind' = 'create'
            AND l.allocation->>'partyType' IN ('employee','supplier')
            AND COALESCE(l.allocation->>'employeeId', l.allocation->>'supplierId') ~ '^[1-9][0-9]{0,9}$'
      ), entry_parties AS (
        SELECT l.journal_entry_id AS entry_id, p.party_type, p.party_id
          FROM line_parties p JOIN journal_lines l ON l.id = p.line_id
        UNION
        SELECT journal_entry_id, party_type, party_id::bigint FROM payables
        UNION
        SELECT e.owner_id, 'employee', a.employee_id::bigint
          FROM effective e JOIN payroll_adjustments a ON a.journal_entry_id = e.owner_id
            OR (e.owner_type = 'payroll_receivable' AND e.owner_source_id = a.id)
        UNION
        SELECT e.owner_id, 'employee', split_part(c.source_key, ':', 2)::bigint
          FROM effective e JOIN cash_transactions c ON c.journal_entry_id = e.owner_id
            OR (e.owner_type = 'cash' AND e.owner_source_id = c.id)
            OR (e.owner_type = 'bank_transaction' AND e.owner_source_id = c.bank_transaction_id)
            OR (e.owner_type IN ('payroll','payroll_advance') AND e.owner_source_id = c.id AND c.source_type = e.owner_type)
          WHERE c.source_type IN ('payroll','payroll_advance')
            AND c.source_key ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2]):[1-9][0-9]{0,9}(:[1-9][0-9]{0,4})?$'
      ), ranked_lines AS (
        SELECT l.*, row_number() OVER (
          PARTITION BY l.journal_entry_id, l.account_id, l.debit, l.credit, l.memo ORDER BY l.id
        ) AS occurrence
        FROM journal_lines l
        WHERE EXISTS (SELECT 1 FROM effective e WHERE e.id = l.journal_entry_id OR e.owner_id = l.journal_entry_id)
      ), scoped AS (
        SELECT l.id, e.date, e.source_type, e.description, c.code AS account_code, c.name AS account_name,
          l.debit, l.credit, c.code IN ('1200','2000') AS affects_balance, e.id AS journal_entry_id,
          (SELECT min(b.id) FROM bank_transactions b
            WHERE b.journal_entry_id = e.owner_id
              OR (e.owner_type = 'bank_transaction' AND b.id = e.owner_source_id)
              OR (e.owner_type = 'cash' AND b.cash_transaction_id = e.owner_source_id)) AS bank_transaction_id
        FROM effective e JOIN ranked_lines l ON l.journal_entry_id = e.id
        LEFT JOIN ranked_lines original_line ON e.source_type = 'reversal'
          AND original_line.journal_entry_id = e.owner_id AND original_line.account_id = l.account_id
          AND original_line.debit = l.credit AND original_line.credit = l.debit
          AND original_line.memo IS NOT DISTINCT FROM l.memo AND original_line.occurrence = l.occurrence
        JOIN chart_of_accounts c ON c.id = l.account_id
        WHERE EXISTS (SELECT 1 FROM entry_parties p WHERE p.entry_id = e.owner_id
          AND p.party_type = ${partyType} AND p.party_id = ${partyId})
          AND (c.code NOT IN ('1200','2000')
            OR EXISTS (SELECT 1 FROM line_parties p
              WHERE p.line_id = CASE WHEN e.source_type = 'reversal' THEN original_line.id ELSE l.id END
                AND p.party_type = ${partyType} AND p.party_id = ${partyId})
            OR (NOT EXISTS(SELECT 1 FROM line_parties p
                WHERE p.line_id = CASE WHEN e.source_type = 'reversal' THEN original_line.id ELSE l.id END)
              AND (SELECT count(*) FROM entry_parties p WHERE p.entry_id = e.owner_id) = 1))
      ), opening AS (
        SELECT COALESCE(sum(debit-credit) FILTER(WHERE affects_balance),0) AS balance
          FROM scoped WHERE date < ${from}::date
      ), report AS (
        SELECT *, (SELECT balance FROM opening)
          + sum(CASE WHEN affects_balance THEN debit-credit ELSE 0 END)
            OVER(ORDER BY date, journal_entry_id, id ROWS UNBOUNDED PRECEDING) AS balance
          FROM scoped WHERE date >= ${from}::date AND date <= ${to}::date
      )
      SELECT (SELECT balance FROM opening) AS opening_balance,
        COALESCE(sum(debit) FILTER(WHERE affects_balance),0) AS total_debit,
        COALESCE(sum(credit) FILTER(WHERE affects_balance),0) AS total_credit,
        COALESCE(jsonb_agg(jsonb_build_object(
          'id',id,'date',date,'sourceType',source_type,'description',description,
          'accountCode',account_code,'accountName',account_name,'debit',debit,'credit',credit,
          'balance',balance,'affectsBalance',affects_balance,'journalEntryId',journal_entry_id,
          'bankTransactionId',bank_transaction_id
        ) ORDER BY date,journal_entry_id,id),'[]'::jsonb) AS lines FROM report
    `);
    const totals = result.rows[0];
    const openingBalance = money(Number(totals.opening_balance));
    const totalDebit = money(Number(totals.total_debit)), totalCredit = money(Number(totals.total_credit));
    const closingBalance = money(openingBalance + totalDebit - totalCredit);
    const warnings: string[] = [
      "Үлдэгдэл болон нийт дебит/кредитэд зөвхөн 1200, 2000 дансны хөдөлгөөн орсон. Бусад мөр нь мэдээллийн зориулалттай.",
      "Эх баримтаар харилцагч нь баталгаатай manual журнал орсон; баталгаатай холбоосгүй журнал ороогүй. Нийлүүлэгчийн худалдан авалтад supplierId холбоос байхгүй тул нэрээр таамаглан хамааруулаагүй.",
    ];
    const twoYearsLater = `${Number(from.slice(0, 4)) + 2}${from.slice(4)}`;
    if (to > twoYearsLater) warnings.push("Сонгосон огнооны завсар 2 жилээс их байна. Тайлан удаан ачаалж болзошгүй.");
    let payroll: PartyLedger["payroll"] = null;
    let unmatchedBankTransactions: PartyLedger["unmatchedBankTransactions"] = [];
    if (partyType === "employee") {
      const month = to.slice(0, 7);
      try {
        const saved = await readSavedPayroll(month, tx);
        const line = saved.lines.find(row => row.employeeId === partyId);
        if (line && line.calculationReady !== false && !line.openingBalanceReviewRequired
          && !(line.refreshMonths ?? []).some(period => period < month)) payroll = {
          month, available: true,
          note: "Сонгосон эцсийн сарын хадгалсан нийт тооцоо; огнооны завсарт хувааж дахин бодоогүй. Цалингийн эерэг үлдэгдэл нь бидний өглөг. Зөрүү = дэвтрийн үлдэгдэл − (цалингийн үлдэгдлийн эсрэг тэмдэг). Нийлбэр өр биш.",
          openingBalance: line.carryoverAmount, payable: line.payable, paidAmount: line.paidAmount,
          advanceAmount: line.advanceAmount, balanceAmount: line.balanceAmount,
          difference: money(closingBalance + line.balanceAmount),
        };
        else payroll = { month, available: false, note: "Ажилтны хадгалсан цалингийн тооцоо эсвэл баталгаатай эхний үлдэгдэл алга. Цалин дахин бодоогүй." };
      } catch (error) {
        if (!(error instanceof PayrollSnapshotMissingError || error instanceof PayrollBalancesNotReadyError)) throw error;
        payroll = { month, available: false, note: error.message };
      }
      const normalized = (party.account ?? "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (normalized) {
        const bank = await tx.execute(sql`
          SELECT b.id, to_char(b.transaction_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,
            b.type, b.amount::float8 AS amount, b.description
          FROM bank_transactions b
          WHERE b.transaction_at >= ${from}::date::timestamp AT TIME ZONE 'UTC'
            AND b.transaction_at < (${to}::date + 1)::timestamp AT TIME ZONE 'UTC'
            AND regexp_replace(upper(b.account), '[^A-Z0-9]', '', 'g') = ${normalized}
            AND b.journal_entry_id IS NULL
            AND NOT EXISTS(SELECT 1 FROM cash_transactions c WHERE c.bank_transaction_id = b.id AND c.journal_entry_id IS NOT NULL)
            AND NOT EXISTS(SELECT 1 FROM journal_entries e WHERE e.source_type = 'bank_transaction' AND e.source_id = b.id)
          ORDER BY b.transaction_at, b.id`);
        unmatchedBankTransactions = bank.rows as PartyLedger["unmatchedBankTransactions"];
        warnings.push("Холбогдоогүй банкны мөрүүд дансны дугаарын яг таарлаар олдсон; цалингийн төлөлт гэж автоматаар тооцоогүй. Нэг дансыг олон ажилтан ашигладаг бол эзэмшигчийг шалгана уу.");
      } else warnings.push("Ажилтны банкны данс хадгалагдаагүй тул холбогдоогүй гүйлгээг хайгаагүй.");
    } else warnings.push("Харилцагчийн бүртгэлд банкны данс байхгүй тул холбогдоогүй банкны гүйлгээний жагсаалт харуулахгүй.");
    return { ...input, partyName: party.name, openingBalance, totalDebit, totalCredit, closingBalance,
      conclusion: ledgerConclusion(closingBalance), warnings, lines: totals.lines as PartyLedger["lines"], payroll, unmatchedBankTransactions };
  };
  return connection ? read(connection) : db.transaction(read, { isolationLevel: "repeatable read", accessMode: "read only" });
}
