import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bankSuggestionScore, descriptionTokens } from "./bank-suggestion-score.js";

describe("bank suggestion ranking", () => {
  const bank = {
    transactionAt: new Date("2026-09-29T08:00:00Z"),
    amount: "100.00",
    description: "Тоног",
    counterparty: "Өргөгч",
  };
  const document = { date: "2026-09-29", amount: "100.00", description: "Өргөгч тоног" };

  it("tokenizes Mongolian text once for all suggestion sources", () => {
    assert.deepEqual([...descriptionTokens("Тоног, ӨРГӨГЧ! тоног")], ["тоног", "өргөгч"]);
    assert.equal(bankSuggestionScore(bank, document), 100);
  });

  it("uses the same date, amount, and text weights for cash and purchase documents", () => {
    assert.equal(bankSuggestionScore(bank, { ...document, date: "2026-09-30" }), 96.43);
    assert.equal(bankSuggestionScore(bank, { ...document, amount: "80.00" }), 95);
    assert.equal(bankSuggestionScore(bank, { ...document, description: "" }), 50);
    assert.equal(bankSuggestionScore(bank, { ...document, description: "ТОНОГ ӨРГӨГЧ" }), 100);
  });
});