import { money } from "./date-utils.js";

type PayrollLine = { employeeId: number; employeeType: string; gross: number; daysWorked: number };
type Plan = { employeeId: number; date: string; shiftId: number };
type WorkedDay = { employeeId: number; date: string; status: string };
type Shift = { id: number; name: string };

/** Allocate saved gross, never recompute salary or financial balances.
 * Multiple shifts share gross in proportion to worked dates. Missing or changed
 * attendance is kept explicitly unassigned instead of inventing a shift.
 */
export function summarizeDashboardPayroll(
  lines: PayrollLine[], plans: Plan[], attendance: WorkedDay[], shifts: Shift[],
) {
  const groups = new Map<number | null, { shiftId: number | null; shiftName: string; cents: number }>(
    shifts.map(shift => [shift.id, { shiftId: shift.id, shiftName: shift.name, cents: 0 }]),
  );
  groups.set(null, { shiftId: null, shiftName: "Ээлж тодорхойгүй", cents: 0 });
  const planByDay = new Map(plans.map(p => [`${p.employeeId}:${p.date}`, p.shiftId]));
  let officeCents = 0;
  let totalCents = 0;
  for (const line of lines) {
    const cents = Math.round(line.gross * 100);
    totalCents += cents;
    if (line.employeeType === "office") {
      officeCents += cents;
      continue;
    }
    const worked = attendance.filter(day => day.employeeId === line.employeeId
      && ["present", "late"].includes(day.status));
    const weights = new Map<number | null, number>();
    if (worked.length === line.daysWorked && worked.length > 0) {
      for (const day of worked) {
        const planned = planByDay.get(`${line.employeeId}:${day.date}`);
        const id = planned !== undefined && groups.has(planned) ? planned : null;
        weights.set(id, (weights.get(id) ?? 0) + 1);
      }
    } else {
      weights.set(null, 1);
    }
    // Largest remainders preserve every cent across all shifts, including ties.
    const count = [...weights.values()].reduce((sum, n) => sum + n, 0);
    const allocation = [...weights].map(([id, weight]) => {
      const exact = cents * weight / count;
      return { id, cents: Math.floor(exact), remainder: exact - Math.floor(exact) };
    }).sort((a, b) => b.remainder - a.remainder || (a.id ?? Infinity) - (b.id ?? Infinity));
    let remainder = cents - allocation.reduce((sum, item) => sum + item.cents, 0);
    for (const item of allocation) {
      groups.get(item.id)!.cents += item.cents + (remainder-- > 0 ? 1 : 0);
    }
  }
  return {
    payrollGross: money(totalCents / 100),
    officePayrollGross: money(officeCents / 100),
    payrollByShift: [...groups.values()]
      .filter(group => group.shiftId !== null || group.cents !== 0)
      .map(({ cents, ...group }) => ({ ...group, gross: money(cents / 100) })),
  };
}
