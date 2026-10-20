import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { transferRule, transferScore } from "./bank-internal-transfer.js";
import type { bankTransactionsTable } from "@workspace/db";

type Row = typeof bankTransactionsTable.$inferSelect;
const a = { id: 1, type: "expense", amount: 100, bankAccountId: 10,
  transactionAt: new Date("2026-10-20T12:00:00Z"), cashTransactionId: null,
  transferredAt: null, journalEntryId: null, unclearAt: null, description: "Өөрийн 222 данс", counterparty: "" } as Row;
const b = { ...a, id: 2, type: "income", bankAccountId: 11, description: "" };
describe("internal transfer pure rules", () => {
  it("equal amounts, either argument direction, no fee", () => {
    assert.equal(transferRule(a, b)?.feeAmount, 0);
    assert.equal(transferRule(b, a)?.out.id, a.id);
  });
  it("allows a fee up to exactly 1%, rejects more and negative fee", () => {
    assert.equal(transferRule(a, { ...b, amount: 99 })?.feeAmount, 1);
    assert.equal(transferRule(a, { ...b, amount: 98.99 }), null);
    assert.equal(transferRule(a, { ...b, amount: 100.01 }), null);
  });
  it("allows exactly 2 days, rejects 3 days and two days plus a second", () => {
    assert.ok(transferRule(a, { ...b, transactionAt: new Date("2026-10-22T12:00:00Z") }));
    assert.equal(transferRule(a, { ...b, transactionAt: new Date("2026-10-23T12:00:00Z") }), null);
    assert.equal(transferRule(a, { ...b, transactionAt: new Date("2026-10-22T12:00:01Z") }), null);
  });
  it("rejects same/missing account, same type, self, zero and resolved rows", () => {
    for (const peer of [{ ...b, bankAccountId: 10 }, { ...b, bankAccountId: null },
      { ...b, type: "expense" }, a, { ...b, amount: 0 },
      { ...b, cashTransactionId: 3 }, { ...b, transferredAt: new Date() },
      { ...b, journalEntryId: 3 }, { ...b, unclearAt: new Date() }]) assert.equal(transferRule(a, peer), null);
  });
  it("rejects already paired membership on either side", () => {
    assert.equal(transferRule(a, b, new Set([1])), null);
    assert.equal(transferRule(a, b, new Set([2])), null);
  });
  it("scores amount/date/other account once, not own-account text", () => {
    const accounts = [{ id: 10, accountNumber: "111", bankName: "А банк" },
      { id: 11, accountNumber: "222", bankName: "Б банк" }];
    assert.equal(transferScore(a, b, accounts), 100);
    assert.equal(transferScore({ ...a, description: "111" }, b, accounts), 75);
    assert.equal(transferScore(a, { ...b, amount: 99, transactionAt: new Date("2026-10-21") }, accounts), 25);
  });
});
