/**
 * Read-only comparison of saved payroll earnings/taxes with the current engine.
 * Never refreshes snapshots, payments, closures or financial balances.
 * Usage: pnpm --filter @workspace/api-server run audit:payroll --env=production --month=2026-10
 */
export {};

const args = process.argv.slice(2).filter(arg => arg !== "--");
const environment = args.find(arg => arg.startsWith("--env="))?.slice(6) ?? "development";
const months = args.filter(arg => arg.startsWith("--month=")).map(arg => arg.slice(8));
if (!["development", "production"].includes(environment)
  || months.some(month => !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
  || args.some(arg => !arg.startsWith("--env=") && !arg.startsWith("--month="))) {
  throw new Error("Use --env=development|production and optional --month=YYYY-MM.");
}
if (environment === "production") {
  if (!process.env.PRODUCTION_DATABASE_URL) throw new Error("PRODUCTION_DATABASE_URL is required.");
  process.env.DATABASE_URL = process.env.PRODUCTION_DATABASE_URL;
}

// Import only after choosing the target, so a production audit cannot quietly
// query the development pool. The entire audit is a read-only, consistent view.
const {
  db, pool, employeesTable, employeeSalaryHistoryTable, attendanceTable,
  payrollScheduleSettingsTable, payrollAttendanceSnapshotsTable, payrollMonthClosuresTable,
} = await import("@workspace/db");
const { sql, asc } = await import("drizzle-orm");
const { calculatePayrollMonth } = await import("../lib/payroll-calc-helpers.js");

const fields = ["daysWorked", "gross", "socialInsuranceSalary", "socialInsurance", "incomeTax"] as const;
type Finding = {
  month: string; employeeId?: number; employeeName?: string; closed: boolean;
  kind: "configuration_error" | "different_saved_calculation" | "missing_saved_calculation";
  details: unknown;
};
try {
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
    await tx.execute(sql`SET LOCAL search_path TO public`);
    // One transaction uses one pg client; do not queue concurrent queries on it.
    const employees = await tx.select().from(employeesTable);
    const salaryHistory = await tx.select().from(employeeSalaryHistoryTable);
    const records = await tx.select().from(attendanceTable);
    const schedules = await tx.select().from(payrollScheduleSettingsTable)
      .orderBy(asc(payrollScheduleSettingsTable.effectiveFromMonth));
    const snapshots = await tx.select().from(payrollAttendanceSnapshotsTable);
    const closures = await tx.select().from(payrollMonthClosuresTable);
    const selectedMonths = months.length ? [...new Set(months)].sort() : snapshots.map(row => row.month).sort();
    const findings: Finding[] = [];
    let checkedEmployees = 0;
    for (const month of selectedMonths) {
      const closed = closures.some(row => row.month === month);
      const schedule = schedules.filter(row => row.effectiveFromMonth <= month).at(-1);
      if (!schedule) {
        findings.push({ month, closed, kind: "configuration_error", details: "No effective payroll schedule" });
        continue;
      }
      const snapshot = snapshots.find(row => row.month === month);
      const savedLines = (snapshot?.payroll.lines ?? []) as Array<Record<string, unknown>>;
      for (const employee of employees) {
        const context = { month, closed, employeeId: employee.id, employeeName: employee.name };
        try {
          // Only earnings/taxes are compared. Deliberately exclude live debt,
          // payments and advances, which have their own saved financial rules.
          const fresh = calculatePayrollMonth(month, {
            allEmployees: [employee],
            salaryHistory: salaryHistory.filter(row => row.employeeId === employee.id),
            records: records.filter(row => row.employeeId === employee.id),
            allAdjustments: [], allAdvanceApprovals: [],
          }, schedule).lines[0];
          if (!fresh) continue;
          checkedEmployees++;
          const saved = savedLines.find(row => row.employeeId === employee.id);
          if (!saved || saved.calculationReady === false) {
            findings.push({ ...context, kind: "missing_saved_calculation", details: null });
            continue;
          }
          const differences = fields.flatMap(field =>
            Math.abs(Number(saved[field] ?? 0) - fresh[field]) > 0.005
              ? [{ field, saved: saved[field], calculated: fresh[field] }] : []);
          if (differences.length) {
            findings.push({ ...context, kind: "different_saved_calculation", details: differences });
          }
        } catch (error) {
          findings.push({ ...context, kind: "configuration_error",
            details: error instanceof Error ? error.message : "Unknown calculation error" });
        }
      }
    }
    return { environment, readOnly: true, months: selectedMonths, checkedEmployees, findings };
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  // A mismatch needs review, not automatic correction: saved calculations may
  // intentionally predate source edits, and closed months must remain frozen.
  if (result.findings.length) process.exitCode = 1;
} finally {
  await pool.end();
}
