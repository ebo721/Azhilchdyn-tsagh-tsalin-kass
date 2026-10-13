import assert from "node:assert/strict";
import { test } from "node:test";
import { planInventoryLots, type InventoryLot } from "./inventory-lot-plan.js";

const lots: InventoryLot[] = [
  { id: 1, date: "2026-09-01", source: "purchase", remainingQuantity: 10, unitPrice: 2000 },
  { id: 1, date: "2026-08-01", source: "opening", remainingQuantity: 5, unitPrice: 1000 },
];

test("historical opening stock is consumed before later purchases", () => {
  assert.deepEqual(planInventoryLots(lots, 7), [
    { openingBalanceId: 1, quantity: 5, unitPrice: 1000 },
    { purchaseItemId: 1, quantity: 2, unitPrice: 2000 },
  ]);
});
test("insufficient and empty stock cannot be issued", () => {
  assert.equal(planInventoryLots(lots, 16), null);
  assert.equal(planInventoryLots([], 1), null);
});
test("fractional stock keeps three-decimal quantity precision", () => {
  assert.deepEqual(planInventoryLots([
    { ...lots[0], remainingQuantity: 0.002 },
    { ...lots[1], remainingQuantity: 0.003 },
  ], 0.004), [
    { openingBalanceId: 1, quantity: 0.003, unitPrice: 1000 },
    { purchaseItemId: 1, quantity: 0.001, unitPrice: 2000 },
  ]);
});
test("same-day opening lots precede purchases, and purchase order stays stable", () => {
  assert.deepEqual(planInventoryLots([
    { ...lots[0], id: 3, remainingQuantity: 1 },
    { ...lots[0], id: 2, remainingQuantity: 1 },
    { ...lots[1], date: lots[0].date, remainingQuantity: 1 },
  ], 3)?.map((line) => line.openingBalanceId ?? line.purchaseItemId), [1, 2, 3]);
});
