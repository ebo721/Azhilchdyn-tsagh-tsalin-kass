import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, sql } from "drizzle-orm";
import { bankTransactionsTable, cashTransactionsTable, chartOfAccountsTable, db, operatingExpensesTable, usersTable } from "@workspace/db";
import app from "../app";
import { createStaffSession, hrCookie } from "../lib/hr-session";
import { fallbackExpenseAccount } from "./operations";

describe("operating expenses", () => {
  let server: Server;
  let baseUrl: string;
  let adminCookie: string;
  let expenseId: number;
  let bankId: number;
  let expenseAccountId: number;
  before(async () => {
    process.env.SESSION_SECRET = "operating-expense-test";
    const [admin] = await db.select().from(usersTable).where(eq(usersTable.role, "admin")).limit(1);
    assert.ok(admin);
    adminCookie = `${hrCookie.name}=${createStaffSession(admin)}`;
    await db.insert(chartOfAccountsTable).values({ code: "6900", name: "Бусад үйл ажиллагааны зардал", type: "expense" }).onConflictDoNothing({ target: chartOfAccountsTable.code });
    const [expenseAccount] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "6900"));
    expenseAccountId = expenseAccount.id;
    const [expense] = await db.insert(operatingExpensesTable).values({ description: `test expense ${process.pid}`, category: "supplies", accountId: expenseAccountId, date: "2099-03-10", amount: 1200 }).returning({ id: operatingExpensesTable.id });
    expenseId = expense.id;
    const [bank] = await db.insert(bankTransactionsTable).values({
      transactionAt: new Date("2099-03-12T09:00:00Z"), type: "expense", amount: 1300,
      counterparty: `matched counterparty ${process.pid}`, description: "unrelated bank text",
      fingerprint: `operating-expense-${process.pid}`,
    }).returning({ id: bankTransactionsTable.id });
    bankId = bank.id;
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    await db.delete(cashTransactionsTable).where(eq(cashTransactionsTable.sourceKey, `expense:${expenseId}`));
    await db.delete(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    await db.delete(operatingExpensesTable).where(eq(operatingExpensesTable.id, expenseId));
    server.close();
  });

  it("supports CRUD, ranked suggestions, linking, cancellation and deletion", async () => {
    const create = await fetch(`${baseUrl}/api/operating-expenses`, { method: "POST", headers: { "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify({ description: "new expense", accountId: expenseAccountId, date: "2099-03-11", amount: 1250 }) });
    assert.equal(create.status, 201);
    const created = await create.json() as { id: number };
    const list = await fetch(`${baseUrl}/api/operating-expenses`, { headers: { cookie: adminCookie } });
    assert.equal(list.status, 200);
    const update = await fetch(`${baseUrl}/api/operating-expenses/${created.id}`, { method: "PUT", headers: { "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify({ description: "updated", accountId: expenseAccountId, date: "2099-03-11", amount: 1300 }) });
    assert.equal(update.status, 200);
    const suggestions = await fetch(`${baseUrl}/api/operating-expenses/${expenseId}/payment-bank-suggestions`, { headers: { cookie: adminCookie } });
    assert.equal(suggestions.status, 200);
    assert.equal((await suggestions.json() as Array<{ id: number }>)[0].id, bankId);
    const pay = await fetch(`${baseUrl}/api/operating-expenses/${expenseId}/payment`, { method: "PUT", headers: { "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify({ date: "2099-03-12", amount: 1300, bankTransactionId: bankId }) });
    assert.equal(pay.status, 200);
    const [cash] = await db.select().from(cashTransactionsTable).where(eq(cashTransactionsTable.sourceKey, `expense:${expenseId}`));
    assert.equal(cash.category, "Үйл ажиллагааны зардал");
    assert.equal(cash.sourceType, "operating_expense");
    assert.ok(cash.bankVerifiedAt);
    const [linked] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    assert.equal(linked.cashTransactionId, cash.id);
    const cancel = await fetch(`${baseUrl}/api/operating-expenses/${expenseId}/payment`, { method: "DELETE", headers: { cookie: adminCookie } });
    assert.equal(cancel.status, 200);
    const [released] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankId));
    assert.equal(released.cashTransactionId, null);
    const del = await fetch(`${baseUrl}/api/operating-expenses/${created.id}`, { method: "DELETE", headers: { cookie: adminCookie } });
    assert.equal(del.status, 204);
    const cleanup = await db.delete(operatingExpensesTable).where(eq(operatingExpensesTable.id, created.id));
    void cleanup;
  });

  it("allows one concurrent bank claim and gives viewers read-only access", async () => {
    const rows = await db.insert(operatingExpensesTable).values([
      { description: "concurrent a", category: "x", accountId: expenseAccountId, date: "2099-04-10", amount: 500 },
      { description: "concurrent b", category: "x", accountId: expenseAccountId, date: "2099-04-10", amount: 500 },
    ]).returning({ id: operatingExpensesTable.id });
    const [bank] = await db.insert(bankTransactionsTable).values({ transactionAt: new Date("2099-04-11T10:00:00Z"), type: "expense", amount: 500, description: "concurrent", fingerprint: `operating-concurrent-${process.pid}` }).returning({ id: bankTransactionsTable.id });
    try {
      const responses = await Promise.all(rows.map((row) => fetch(`${baseUrl}/api/operating-expenses/${row.id}/payment`, { method: "PUT", headers: { "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify({ date: "2099-04-11", amount: 500, bankTransactionId: bank.id }) })));
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      const viewer = await db.select().from(usersTable).where(eq(usersTable.role, "viewer")).limit(1);
      if (viewer[0]) {
        const response = await fetch(`${baseUrl}/api/operating-expenses`, { headers: { cookie: `${hrCookie.name}=${createStaffSession(viewer[0])}` } });
        assert.equal(response.status, 200);
        const deniedMutation = await fetch(`${baseUrl}/api/operating-expenses`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: `${hrCookie.name}=${createStaffSession(viewer[0])}` },
          body: JSON.stringify({ description: "viewer must not create", accountId: expenseAccountId, date: "2099-04-10", amount: 500 }),
        });
        assert.equal(deniedMutation.status, 403);
      }
    } finally {
      await db.update(bankTransactionsTable).set({ cashTransactionId: null, transferredAt: null }).where(eq(bankTransactionsTable.id, bank.id));
      await db.update(operatingExpensesTable).set({ bankTransactionId: null, cashTransactionId: null }).where(inArray(operatingExpensesTable.id, rows.map((r) => r.id)));
      await db.delete(cashTransactionsTable).where(eq(cashTransactionsTable.bankTransactionId, bank.id));
      await db.delete(operatingExpensesTable).where(inArray(operatingExpensesTable.id, rows.map((r) => r.id)));
      await db.delete(bankTransactionsTable).where(eq(bankTransactionsTable.id, bank.id));
    }
  });

  it("allows warehouse users to view and manage operating expenses", async () => {
    const [warehouse] = await db.select().from(usersTable).where(eq(usersTable.role, "warehouse")).limit(1);
    assert.ok(warehouse);
    const warehouseCookie = `${hrCookie.name}=${createStaffSession(warehouse)}`;
    const list = await fetch(`${baseUrl}/api/operating-expenses`, { headers: { cookie: warehouseCookie } });
    assert.equal(list.status, 200);

    const create = await fetch(`${baseUrl}/api/operating-expenses`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: warehouseCookie },
      body: JSON.stringify({
        description: `warehouse expense ${process.pid}`,
        accountId: expenseAccountId,
        date: "2099-05-10",
        amount: 900,
      }),
    });
    assert.equal(create.status, 201);
    const created = await create.json() as { id: number };
    await db.delete(operatingExpensesTable).where(eq(operatingExpensesTable.id, created.id));
  });

  it("stores manual cash expenses under the operating expense category and keeps their subcategory", async () => {
    const create = await fetch(`${baseUrl}/api/cash/transactions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        type: "expense",
        category: "Түрээс",
        description: "Гар кассын түрээс",
        amount: 7800,
        date: "2099-06-10",
        incomeMonth: null,
      }),
    });
    assert.equal(create.status, 201);
    const created = await create.json() as { id: number; category: string; subcategory: string | null };
    assert.equal(created.category, "Үйл ажиллагааны зардал");
    assert.equal(created.subcategory, "Түрээс");

    const list = await fetch(`${baseUrl}/api/cash/transactions`, { headers: { cookie: adminCookie } });
    assert.equal(list.status, 200);
    const listed = (await list.json() as Array<{ id: number; category: string; subcategory: string | null }>)
      .find((row) => row.id === created.id);
    assert.equal(listed?.category, "Үйл ажиллагааны зардал");
    assert.equal(listed?.subcategory, "Түрээс");

    const [expense] = await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.cashTransactionId, created.id));
    assert.ok(expense);
    assert.equal(expense.category, "Түрээс");
    const [mappedAccount] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, expense.accountId));
    assert.equal(mappedAccount.code, "6100");
    assert.equal(mappedAccount.type, "expense");

    const remove = await fetch(`${baseUrl}/api/cash/transactions/${created.id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    assert.equal(remove.status, 204);
    assert.equal((await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.cashTransactionId, created.id))).length, 0);
  });

  it("rejects a reserved fallback code when it is not an expense account", async () => {
    const [account] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "6500"));
    assert.ok(account);
    await db.update(chartOfAccountsTable).set({ type: "asset" }).where(eq(chartOfAccountsTable.id, account.id));
    try {
      await assert.rejects(
        () => fallbackExpenseAccount(db, "Засвар үйлчилгээ"),
        /non-expense type|invalid type/,
      );
    } finally {
      await db.update(chartOfAccountsTable).set({ type: "expense" }).where(eq(chartOfAccountsTable.id, account.id));
    }
  });

  it("prevents account edits from breaking later cash expense creation", async () => {
    const [account] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.code, "6500"));
    assert.ok(account);
    const update = await fetch(`${baseUrl}/api/chart-of-accounts/${account.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ code: account.code, name: account.name, type: "asset" }),
    });
    assert.equal(update.status, 400);

    const create = await fetch(`${baseUrl}/api/cash/transactions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        type: "expense",
        category: "Засвар үйлчилгээ",
        description: `reserved account route test ${process.pid}`,
        amount: 100,
        date: "2099-06-11",
        incomeMonth: null,
      }),
    });
    assert.equal(create.status, 201);
    const created = await create.json() as { id: number };
    const [expense] = await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.cashTransactionId, created.id));
    assert.equal(expense.accountId, account.id);
    await db.delete(operatingExpensesTable).where(eq(operatingExpensesTable.cashTransactionId, created.id));
    await db.delete(cashTransactionsTable).where(eq(cashTransactionsTable.id, created.id));
  });

  it("serializes expense creation against account type changes", async () => {
    const code = `79${String(process.pid).slice(-2)}`;
    const [account] = await db.insert(chartOfAccountsTable).values({
      code,
      name: `Concurrent expense ${process.pid}`,
      type: "expense",
    }).returning();
    let createdExpenseId: number | undefined;
    try {
      const [create, update] = await Promise.all([
        fetch(`${baseUrl}/api/operating-expenses`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: adminCookie },
          body: JSON.stringify({
            description: `concurrent account expense ${process.pid}`,
            accountId: account.id,
            date: "2099-06-12",
            amount: 200,
          }),
        }),
        fetch(`${baseUrl}/api/chart-of-accounts/${account.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json", cookie: adminCookie },
          body: JSON.stringify({ code, name: account.name, type: "asset" }),
        }),
      ]);
      assert.ok(
        (create.status === 201 && update.status === 409)
        || (create.status === 400 && update.status === 200),
        `unexpected statuses: create=${create.status}, update=${update.status}`,
      );
      if (create.status === 201) {
        createdExpenseId = ((await create.json()) as { id: number }).id;
      }
      const invalidRows = await db.select({ id: operatingExpensesTable.id })
        .from(operatingExpensesTable)
        .innerJoin(chartOfAccountsTable, eq(chartOfAccountsTable.id, operatingExpensesTable.accountId))
        .where(and(eq(operatingExpensesTable.accountId, account.id), sql`${chartOfAccountsTable.type} <> 'expense'`));
      assert.equal(invalidRows.length, 0);
    } finally {
      if (createdExpenseId) {
        await db.delete(operatingExpensesTable).where(eq(operatingExpensesTable.id, createdExpenseId));
      }
      await db.delete(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, account.id));
    }
  });

  it("reconciles historical and future bank expenses while excluding system sources", async () => {
    const bankIds: number[] = [];
    const cashIds: number[] = [];
    try {
      const createPair = async (sourceType: string | null, suffix: string, category: string) => {
        const [bank] = await db.insert(bankTransactionsTable).values({
          transactionAt: new Date(`2099-05-${suffix}T10:00:00Z`),
          type: "expense",
          amount: 2000 + Number(suffix),
          description: `historical ${suffix}`,
          fingerprint: `operating-history-${process.pid}-${suffix}`,
        }).returning({ id: bankTransactionsTable.id });
        const [cash] = await db.insert(cashTransactionsTable).values({
          type: "expense",
          category,
          description: `historical ${suffix}`,
          amount: 2000 + Number(suffix),
          date: `2099-05-${suffix}`,
          sourceType,
          sourceKey: sourceType ? `${sourceType}:${process.pid}:${suffix}` : null,
          bankTransactionId: bank.id,
          bankVerifiedAt: new Date(),
        }).returning({ id: cashTransactionsTable.id });
        await db.update(bankTransactionsTable)
          .set({ cashTransactionId: cash.id, transferredAt: new Date() })
          .where(eq(bankTransactionsTable.id, bank.id));
        bankIds.push(bank.id);
        cashIds.push(cash.id);
        return { bank, cash };
      };

      const historical = await createPair("bank_transaction", "10", "Түрээс");
      const excluded = await Promise.all([
        createPair("payroll", "11", "Цалин"),
        createPair("payroll_advance", "12", "Цалингийн урьдчилгаа"),
        createPair("inventory_purchase", "13", "Бараа материал"),
        createPair("fixed_asset_purchase", "14", "Эд хөрөнгө"),
      ]);

      const firstList = await fetch(`${baseUrl}/api/operating-expenses`, { headers: { cookie: adminCookie } });
      assert.equal(firstList.status, 200);
      const firstRows = await firstList.json() as Array<{ bankTransactionId: number | null; cashTransactionId: number | null; category: string; paymentDate: string | null }>;
      const reconciled = firstRows.filter((row) => row.bankTransactionId === historical.bank.id);
      assert.equal(reconciled.length, 1);
      assert.equal(reconciled[0].cashTransactionId, historical.cash.id);
      assert.equal(reconciled[0].category, "Түрээс");
      assert.equal(reconciled[0].paymentDate, "2099-05-10");
      const [historicalExpense] = await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.bankTransactionId, historical.bank.id));
      const [historicalAccount] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, historicalExpense.accountId));
      assert.equal(historicalAccount.code, "6100");
      assert.equal(historicalAccount.type, "expense");
      for (const pair of excluded) {
        assert.equal(firstRows.some((row) => row.bankTransactionId === pair.bank.id), false);
      }

      const secondList = await fetch(`${baseUrl}/api/operating-expenses`, { headers: { cookie: adminCookie } });
      const secondRows = await secondList.json() as Array<{ bankTransactionId: number | null }>;
      assert.equal(secondRows.filter((row) => row.bankTransactionId === historical.bank.id).length, 1);

      const [futureBank] = await db.insert(bankTransactionsTable).values({
        transactionAt: new Date("2099-05-20T10:00:00Z"),
        type: "expense",
        amount: 4500,
        description: "шатахуун",
        fingerprint: `operating-future-${process.pid}`,
      }).returning({ id: bankTransactionsTable.id });
      bankIds.push(futureBank.id);
      const transfer = await fetch(`${baseUrl}/api/bank-transactions/${futureBank.id}/transfer-to-cash`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ category: "Шатахуун", incomeMonth: null }),
      });
      assert.equal(transfer.status, 200);
      const [futureExpense] = await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.bankTransactionId, futureBank.id));
      assert.ok(futureExpense);
      assert.equal(futureExpense.category, "Шатахуун");
      assert.ok(futureExpense.cashTransactionId);
      cashIds.push(futureExpense.cashTransactionId);

      const [linkBank] = await db.insert(bankTransactionsTable).values({
        transactionAt: new Date("2099-05-21T10:00:00Z"),
        type: "expense",
        amount: 5100,
        description: "интернет",
        fingerprint: `operating-link-${process.pid}`,
      }).returning({ id: bankTransactionsTable.id });
      bankIds.push(linkBank.id);
      const [manualCash] = await db.insert(cashTransactionsTable).values({
        type: "expense",
        category: "Интернет",
        description: "интернет",
        amount: 5100,
        date: "2099-05-21",
      }).returning({ id: cashTransactionsTable.id });
      cashIds.push(manualCash.id);
      const link = await fetch(`${baseUrl}/api/bank-transactions/${linkBank.id}/link-cash`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ cashTransactionId: manualCash.id }),
      });
      assert.equal(link.status, 200);
      const [linkedExpense] = await db.select().from(operatingExpensesTable).where(eq(operatingExpensesTable.bankTransactionId, linkBank.id));
      assert.ok(linkedExpense);
      assert.equal(linkedExpense.cashTransactionId, manualCash.id);
      assert.equal(linkedExpense.category, "Интернет");
    } finally {
      if (bankIds.length) await db.delete(operatingExpensesTable).where(inArray(operatingExpensesTable.bankTransactionId, bankIds));
      if (bankIds.length) await db.update(bankTransactionsTable).set({ cashTransactionId: null, transferredAt: null }).where(inArray(bankTransactionsTable.id, bankIds));
      if (cashIds.length) await db.delete(cashTransactionsTable).where(inArray(cashTransactionsTable.id, cashIds));
      if (bankIds.length) await db.delete(bankTransactionsTable).where(inArray(bankTransactionsTable.id, bankIds));
    }
  });
});