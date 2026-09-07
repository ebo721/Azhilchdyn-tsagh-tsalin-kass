import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planShiftPlanCopy, type ShiftPlanCopySource } from "./shift-plan-copy.ts";

const source = (
  id: number,
  employeeId: number,
  date: string,
  shiftId: number,
): ShiftPlanCopySource => ({ id, employeeId, date, shiftId });

const common = {
  activeEmployeeIds: new Set([1]),
  validShiftIds: new Set([10, 11]),
  targetPlans: [],
};

describe("planShiftPlanCopy", () => {
  for (const { targetMonth, targetDayCount } of [
    { targetMonth: "2026-04", targetDayCount: 30 },
    { targetMonth: "2025-02", targetDayCount: 28 },
    { targetMonth: "2024-02", targetDayCount: 29 },
  ]) {
    it(`skips January 31 when copying to ${targetMonth}`, () => {
      const result = planShiftPlanCopy({
        ...common,
        sourceMonth: "2026-01",
        targetMonth,
        targetDayCount,
        overwrite: false,
        sourcePlans: [source(1, 1, "2026-01-31", 10)],
      });

      assert.deepEqual(result, {
        actions: [],
        copied: 0,
        overwritten: 0,
        skipped: 0,
        unavailableDates: 1,
      });
    });
  }

  it("does not copy plans belonging to inactive employees", () => {
    const result = planShiftPlanCopy({
      ...common,
      sourceMonth: "2026-03",
      targetMonth: "2026-04",
      targetDayCount: 30,
      overwrite: false,
      sourcePlans: [source(1, 2, "2026-03-15", 10)],
    });

    assert.equal(result.actions.length, 0);
    assert.deepEqual(
      { copied: result.copied, overwritten: result.overwritten, skipped: result.skipped, unavailableDates: result.unavailableDates },
      { copied: 0, overwritten: 0, skipped: 0, unavailableDates: 0 },
    );
  });

  it("does not copy plans that reference an invalid shift", () => {
    const result = planShiftPlanCopy({
      ...common,
      sourceMonth: "2026-03",
      targetMonth: "2026-04",
      targetDayCount: 30,
      overwrite: false,
      sourcePlans: [source(1, 1, "2026-03-15", 99)],
    });

    assert.equal(result.actions.length, 0);
    assert.deepEqual(
      { copied: result.copied, overwritten: result.overwritten, skipped: result.skipped, unavailableDates: result.unavailableDates },
      { copied: 0, overwritten: 0, skipped: 0, unavailableDates: 0 },
    );
  });

  it("counts inserted and skipped plans when overwrite is false", () => {
    const result = planShiftPlanCopy({
      ...common,
      sourceMonth: "2026-03",
      targetMonth: "2026-04",
      targetDayCount: 30,
      overwrite: false,
      sourcePlans: [
        source(1, 1, "2026-03-01", 10),
        source(2, 1, "2026-03-02", 11),
      ],
      targetPlans: [source(20, 1, "2026-04-02", 10)],
    });

    assert.deepEqual(result, {
      actions: [{ type: "insert", employeeId: 1, date: "2026-04-01", shiftId: 10 }],
      copied: 1,
      overwritten: 0,
      skipped: 1,
      unavailableDates: 0,
    });
  });

  it("counts inserted and overwritten plans when overwrite is true", () => {
    const result = planShiftPlanCopy({
      ...common,
      sourceMonth: "2026-03",
      targetMonth: "2026-04",
      targetDayCount: 30,
      overwrite: true,
      sourcePlans: [
        source(1, 1, "2026-03-01", 10),
        source(2, 1, "2026-03-02", 11),
      ],
      targetPlans: [source(20, 1, "2026-04-02", 10)],
    });

    assert.deepEqual(result, {
      actions: [
        { type: "insert", employeeId: 1, date: "2026-04-01", shiftId: 10 },
        { type: "update", targetId: 20, shiftId: 11 },
      ],
      copied: 1,
      overwritten: 1,
      skipped: 0,
      unavailableDates: 0,
    });
  });
});