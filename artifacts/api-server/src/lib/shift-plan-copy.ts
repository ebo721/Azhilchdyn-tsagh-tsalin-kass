export type ShiftPlanCopySource = {
  id: number;
  employeeId: number;
  date: string;
  shiftId: number;
};

export type ShiftPlanCopyTarget = ShiftPlanCopySource;

export type ShiftPlanCopyAction =
  | {
      type: "insert";
      employeeId: number;
      date: string;
      shiftId: number;
    }
  | {
      type: "update";
      targetId: number;
      shiftId: number;
    };

type PlanShiftPlanCopyInput = {
  sourceMonth: string;
  targetMonth: string;
  targetDayCount: number;
  overwrite: boolean;
  activeEmployeeIds: ReadonlySet<number>;
  validShiftIds: ReadonlySet<number>;
  sourcePlans: readonly ShiftPlanCopySource[];
  targetPlans: readonly ShiftPlanCopyTarget[];
};

export function planShiftPlanCopy({
  sourceMonth,
  targetMonth,
  targetDayCount,
  overwrite,
  activeEmployeeIds,
  validShiftIds,
  sourcePlans,
  targetPlans,
}: PlanShiftPlanCopyInput) {
  const targetByKey = new Map(
    targetPlans
      .filter((plan) => plan.date.startsWith(targetMonth))
      .map((plan) => [`${plan.employeeId}-${plan.date}`, plan]),
  );
  const actions: ShiftPlanCopyAction[] = [];
  let copied = 0;
  let overwritten = 0;
  let skipped = 0;
  let unavailableDates = 0;

  for (const source of sourcePlans) {
    if (
      !source.date.startsWith(sourceMonth)
      || !activeEmployeeIds.has(source.employeeId)
      || !validShiftIds.has(source.shiftId)
    ) {
      continue;
    }
    const day = Number(source.date.slice(8, 10));
    if (day > targetDayCount) {
      unavailableDates += 1;
      continue;
    }
    const date = `${targetMonth}-${String(day).padStart(2, "0")}`;
    const existing = targetByKey.get(`${source.employeeId}-${date}`);
    if (existing && !overwrite) {
      skipped += 1;
      continue;
    }
    if (existing) {
      actions.push({ type: "update", targetId: existing.id, shiftId: source.shiftId });
      overwritten += 1;
    } else {
      actions.push({
        type: "insert",
        employeeId: source.employeeId,
        date,
        shiftId: source.shiftId,
      });
      copied += 1;
    }
  }

  return {
    actions,
    copied,
    overwritten,
    skipped,
    unavailableDates,
  };
}