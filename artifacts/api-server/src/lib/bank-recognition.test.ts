import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type BankRecognitionContext,
  type RecognizableBankTransaction,
  recognizeBankTransaction,
} from "./bank-recognition";

const transaction = (overrides: Partial<RecognizableBankTransaction> = {}): RecognizableBankTransaction => ({
  transactionAt: new Date("2026-09-18T10:00:00.000Z"),
  type: "expense",
  amount: 100_000,
  account: "99112233 / Нийлүүлэгч",
  counterparty: "99112233 / Нийлүүлэгч",
  description: "9 сарын түрээс",
  bankAccountNumber: "1234567890",
  ...overrides,
});

const context = (overrides: Partial<BankRecognitionContext> = {}): BankRecognitionContext => ({
  unpaidTargets: [],
  historical: [],
  keywordAccounts: new Map([
    ["1000", 1000],
    ["1500", 1500],
    ["1510", 1510],
    ["6000", 6000],
    ["6010", 6010],
    ["6100", 6100],
    ["6200", 6200],
    ["6400", 6400],
    ["2200", 2200],
  ]),
  ...overrides,
});

describe("ordered bank recognition", () => {
  it("uses an unpaid target before historical identity and keywords", () => {
    const result = recognizeBankTransaction(transaction(), context({
      unpaidTargets: [{
        id: 1,
        kind: "operating_expense",
        accountId: 6900,
        date: "2026-09-18",
        amount: 100_000,
        text: "Нийлүүлэгчийн төлбөр",
      }],
      historical: [{
        id: 1,
        type: "expense",
        accountId: 6500,
        account: "99112233 / Нийлүүлэгч",
        counterparty: "99112233 / Нийлүүлэгч",
        bankAccountNumber: "1234567890",
      }],
    }));
    assert.deepEqual(result, {
      accountId: 6900,
      rule: "unpaid_target",
      existingPurchaseMatch: { type: "operating_expense", id: 1 },
    });
  });

  it("uses the latest matching historical identity before a keyword", () => {
    const result = recognizeBankTransaction(transaction(), context({
      historical: [
        {
          id: 2,
          type: "expense",
          accountId: 6500,
          account: "99112233 / Нийлүүлэгч",
          counterparty: "99112233 / Нийлүүлэгч",
          bankAccountNumber: "1234567890",
        },
        {
          id: 1,
          type: "expense",
          accountId: 6900,
          account: "99112233 / Нийлүүлэгч",
          counterparty: "99112233 / Нийлүүлэгч",
          bankAccountNumber: "1234567890",
        },
      ],
    }));
    assert.deepEqual(result, { accountId: 6500, rule: "historical_identity", existingPurchaseMatch: null });
  });

  it("uses configurable salary, social insurance, rent, and VAT keyword accounts", () => {
    assert.equal(recognizeBankTransaction(transaction({ description: "Ажилчдын цалин" }), context()).accountId, 6000);
    assert.equal(recognizeBankTransaction(transaction({ description: "9 сарын НДШ" }), context()).accountId, 6010);
    assert.equal(recognizeBankTransaction(transaction({ description: "Оффисын түрээс" }), context()).accountId, 6100);
    assert.equal(recognizeBankTransaction(transaction({ description: "НӨАТ төлбөр" }), context()).accountId, 2200);
  });

  it("recognizes common imported statement descriptions", () => {
    assert.equal(recognizeBankTransaction(transaction({
      type: "income",
      description: "Касс зузаатгал",
    }), context()).accountId, 1000);
    assert.equal(recognizeBankTransaction(transaction({ description: "ТТТ үхэр, хонь, ямаа мах" }), context()).accountId, 1500);
    assert.equal(recognizeBankTransaction(transaction({ description: "ТТТ ахуйн бараа" }), context()).accountId, 1510);
    assert.equal(recognizeBankTransaction(transaction({ description: "Самасаа ХХК Velfire бинзен" }), context()).accountId, 6200);
    assert.equal(recognizeBankTransaction(transaction({ description: "Хостинг төлбөр" }), context()).accountId, 6400);
  });

  it("uses a specific expense rule before the broad TTT inventory rule", () => {
    assert.equal(
      recognizeBankTransaction(transaction({ description: "ТТТ тээврийн хөлс" }), context()).accountId,
      6200,
    );
    assert.equal(
      recognizeBankTransaction(transaction({ description: "ТТТ агуулах сангийн материал" }), context()).accountId,
      1510,
    );
  });

  it("does not match on the company's bank account number alone", () => {
    const result = recognizeBankTransaction(transaction({
      counterparty: "Өөр харилцагч",
      account: "Өөр данс",
      description: "Тайлбаргүй",
    }), context({
      historical: [{
        id: 3,
        type: "expense",
        accountId: 6900,
        account: "99112233 / Нийлүүлэгч",
        counterparty: "99112233 / Нийлүүлэгч",
        bankAccountNumber: "1234567890",
      }],
    }));
    assert.deepEqual(result, { accountId: null, rule: "none", existingPurchaseMatch: null });
  });

  it("does not match an unpaid target without identity overlap", () => {
    const result = recognizeBankTransaction(transaction({
      description: "Тайлбаргүй",
      account: "Өөр данс",
      counterparty: "Өөр харилцагч",
    }), context({
      unpaidTargets: [{
        id: 1,
        kind: "inventory_purchase",
        accountId: 1500,
        date: "2026-09-18",
        amount: 100_000,
        text: "Хүнсний нийлүүлэгч",
      }],
    }));
    assert.deepEqual(result, { accountId: null, rule: "none", existingPurchaseMatch: null });
  });

  it("leaves ambiguous equal-score unpaid targets unrecognized", () => {
    const result = recognizeBankTransaction(transaction({
      description: "Нийлүүлэгч төлбөр",
    }), context({
      unpaidTargets: [
        {
          id: 2,
          kind: "inventory_purchase",
          accountId: 1500,
          date: "2026-09-18",
          amount: 100_000,
          text: "Нийлүүлэгч",
        },
        {
          id: 1,
          kind: "operating_expense",
          accountId: 6900,
          date: "2026-09-18",
          amount: 100_000,
          text: "Нийлүүлэгч",
        },
      ],
    }));
    assert.deepEqual(result, { accountId: null, rule: "none", existingPurchaseMatch: null });
  });

  it("matches keywords on token boundaries only", () => {
    assert.deepEqual(
      recognizeBankTransaction(transaction({ description: "preventative үйлчилгээ" }), context()),
      { accountId: null, rule: "none", existingPurchaseMatch: null },
    );
    assert.equal(
      recognizeBankTransaction(transaction({ description: "Засвар үйлчилгээ" }), context({
        keywordAccounts: new Map([["6500", 6500]]),
      })).accountId,
      6500,
    );
  });

  it("does not re-suggest a rejected account from any rule", () => {
    const rejected = transaction({ rejectedAccountIds: [6900, 6500, 6100] });
    const result = recognizeBankTransaction(rejected, context({
      unpaidTargets: [{
        id: 1,
        kind: "operating_expense",
        accountId: 6900,
        date: "2026-09-18",
        amount: 100_000,
        text: "Нийлүүлэгч",
      }],
      historical: [{
        id: 1,
        type: "expense",
        accountId: 6500,
        account: "99112233 / Нийлүүлэгч",
        counterparty: "99112233 / Нийлүүлэгч",
        bankAccountNumber: "1234567890",
      }],
    }));
    assert.deepEqual(result, { accountId: null, rule: "none", existingPurchaseMatch: null });
  });
});