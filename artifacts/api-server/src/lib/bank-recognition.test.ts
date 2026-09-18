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
    ["6000", 6000],
    ["6010", 6010],
    ["6100", 6100],
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
    assert.deepEqual(result, { accountId: 6900, rule: "unpaid_target" });
  });

  it("uses the latest matching historical identity before a keyword", () => {
    const result = recognizeBankTransaction(transaction(), context({
      historical: [{
        id: 2,
        type: "expense",
        accountId: 6500,
        account: "99112233 / Нийлүүлэгч",
        counterparty: "99112233 / Нийлүүлэгч",
        bankAccountNumber: "1234567890",
      }],
    }));
    assert.deepEqual(result, { accountId: 6500, rule: "historical_identity" });
  });

  it("uses configurable salary, social insurance, rent, and VAT keyword accounts", () => {
    assert.equal(recognizeBankTransaction(transaction({ description: "Ажилчдын цалин" }), context()).accountId, 6000);
    assert.equal(recognizeBankTransaction(transaction({ description: "9 сарын НДШ" }), context()).accountId, 6010);
    assert.equal(recognizeBankTransaction(transaction({ description: "Оффисын түрээс" }), context()).accountId, 6100);
    assert.equal(recognizeBankTransaction(transaction({ description: "НӨАТ төлбөр" }), context()).accountId, 2200);
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
    assert.deepEqual(result, { accountId: null, rule: "none" });
  });
});