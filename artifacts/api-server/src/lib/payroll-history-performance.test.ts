import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { after, it, type TestContext } from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  pool, employeesTable, employeeSalaryHistoryTable, attendanceTable,
  payrollAdjustmentsTable, payrollAdvanceApprovalsTable, payrollScheduleSettingsTable,
} from "@workspace/db";
import ExcelJS from "exceljs";
import { calculatePayrollMonth, getPayrollSchedule, getPayrollSummary } from "./payroll-calc-helpers.js";
import { defaultPayrollSchedule, selectPayrollScheduleVersion, nextMonth, type PayrollCalculationData } from "./route-shared.js";
import { buildInsuranceWorkbook } from "./social-insurance-report.js";

type Schedule = typeof payrollScheduleSettingsTable.$inferSelect;
const epoch = new Date(0);
function fixture(): { data: PayrollCalculationData; schedules: Schedule[] } {
  const employee: typeof employeesTable.$inferSelect = {
    id: 1, name: "History fixture", role: "Test", phone: "", bankAccountNumber: "",
    employeeType: "office", salaryType: "monthly", baseSalary: 1_500_000,
    socialInsuranceSalary: 1_200_000, payrollTaxExempt: false,
    fullSalaryRegardlessAttendance: false, payFrequency: "twice",
    monthlyExpectedWorkDays: 15, status: "active", joinedAt: "2016-01-01",
    inactiveAt: null,
    socialInsuranceProfile: {
      registrationNumber: "ТТ00000001", clanName: "Fixture", parentName: "Example",
      insuranceTypeCode: "01001", occupationCode: "0000-00", citizenship: "Монгол", email: "",
    },
  };
  const allEmployees = [
    employee,
    { ...employee, id: 2, name: "Shift fixture", employeeType: "shift", salaryType: "daily",
      baseSalary: 100_000, socialInsuranceProfile: { ...employee.socialInsuranceProfile!, registrationNumber: "ТТ00000002" } },
    { ...employee, id: 3, name: "Override fixture", fullSalaryRegardlessAttendance: true,
      payrollTaxExempt: true, baseSalary: 100, socialInsuranceProfile: null },
    { ...employee, id: 4, name: "Ended fixture", joinedAt: "2018-01-15",
      inactiveAt: "2020-02-14", status: "inactive", socialInsuranceProfile: null },
  ];
  const salaryHistory = allEmployees.flatMap(e => [
    { id: e.id, employeeId: e.id, effectiveFrom: e.joinedAt, employeeType: e.employeeType,
      salaryType: e.salaryType, monthlyExpectedWorkDays: e.monthlyExpectedWorkDays,
      baseSalary: e.baseSalary, socialInsuranceSalary: e.socialInsuranceSalary,
      payrollTaxExempt: e.payrollTaxExempt, fullSalaryRegardlessAttendance: e.fullSalaryRegardlessAttendance,
      payFrequency: e.payFrequency, createdAt: epoch },
    ...(e.id <= 2 ? [{
      id: e.id + 10, employeeId: e.id, effectiveFrom: "2019-06-14", employeeType: e.employeeType,
      salaryType: e.salaryType, monthlyExpectedWorkDays: 10,
      baseSalary: e.id === 1 ? 1_800_000 : 120_000, socialInsuranceSalary: 1_500_000,
      payrollTaxExempt: false, fullSalaryRegardlessAttendance: false, payFrequency: "twice", createdAt: epoch,
    }] : []),
    ...(e.id === 2 ? [{
      id: 22, employeeId: e.id, effectiveFrom: "2022-03-15", employeeType: "shift",
      salaryType: "daily", monthlyExpectedWorkDays: 10, baseSalary: 120_000,
      socialInsuranceSalary: 1_500_000, payrollTaxExempt: false,
      fullSalaryRegardlessAttendance: true, payFrequency: "twice", createdAt: epoch,
    }] : []),
  ]);
  const data: PayrollCalculationData = { allEmployees, salaryHistory, records: [], allAdjustments: [], allAdvanceApprovals: [] };
  for (let year = 2016; year <= 2025; year++) {
    for (let m = 1; m <= 12; m++) {
      const month = `${year}-${String(m).padStart(2, "0")}`;
      for (const e of allEmployees) {
        // Empty attendance in alternate months verifies zero new office salary.
        if (e.id !== 3 && m % 2 === 0) {
          for (const day of [2, 14, 16, 25, 28]) {
            data.records.push({
              id: data.records.length + 1, employeeId: e.id, date: `${month}-${day.toString().padStart(2, "0")}`,
              clockIn: "08:00", clockOut: "16:00", hours: 8,
              status: day === 14 ? "leave" : day === 16 ? "late" : "present", createdAt: epoch,
            });
          }
        }
        data.allAdjustments.push({
          id: data.allAdjustments.length + 1, employeeId: e.id, month,
          manualDeduction: e.id === 3 ? 0 : 1000, advanceAmount: 0, taxRelief: 0,
          paidAmount: e.id === 3 ? 80 : m % 3 === 0 ? 1_900_000 : 100_000,
          paymentDate: `${month}-26`, secondPaidAmount: e.id === 3 ? 10 : 20_000,
          secondPaymentDate: `${month}-28`, receivableId: null, journalEntryId: null, updatedAt: epoch,
        });
      }
      data.allAdvanceApprovals.push({
        id: data.allAdvanceApprovals.length + 1, month, approvalDate: `${month}-15`, approvedAt: epoch,
        totalAmount: 70_000,
        lines: [{ employeeId: 1, advanceAmount: 50_000, paid: true },
          { employeeId: 2, advanceAmount: 20_000, paid: false }],
      });
    }
  }
  const schedules: Schedule[] = [
    { id: 1, effectiveFromMonth: "0001-01", ...defaultPayrollSchedule, updatedAt: epoch },
    { id: 2, effectiveFromMonth: "2019-06", ...defaultPayrollSchedule,
      periodStartDay: 26, periodEndDay: 25, advanceCutoffDay: 10, updatedAt: epoch },
    { id: 3, effectiveFromMonth: "2022-03", ...defaultPayrollSchedule, advancePayDay: 20, finalPayDay: 5, updatedAt: epoch },
    { id: 4, effectiveFromMonth: "2026-01", ...defaultPayrollSchedule, periodEndDay: 20, updatedAt: epoch },
  ];
  return { data, schedules };
}

// Exercise real Drizzle SELECT SQL without connecting to or changing a database.
function fakeDatabase(t: TestContext, data: PayrollCalculationData, schedules: Schedule[], latencyMs = 0, baselineConflict = false) {
  const sources = [
    [employeesTable, data.allEmployees], [employeeSalaryHistoryTable, data.salaryHistory],
    [attendanceTable, data.records], [payrollAdjustmentsTable, data.allAdjustments],
    [payrollAdvanceApprovalsTable, data.allAdvanceApprovals], [payrollScheduleSettingsTable, schedules],
  ] as const;
  const queries: string[] = [];
  t.mock.method(pool, "query", (async (query: { text: string }, values: unknown[]) => {
    queries.push(query.text);
    if (latencyMs) await new Promise(resolve => setTimeout(resolve, latencyMs));
    if (query.text.startsWith('insert into "payroll_schedule_settings"')) {
      assert.ok(!schedules.some(row => row.effectiveFromMonth === "0001-01"));
      assert.match(query.text, /on conflict .* do nothing/);
      const baseline = { id: 5, effectiveFromMonth: "0001-01", ...defaultPayrollSchedule, updatedAt: epoch };
      schedules.push(baseline);
      const keys = Object.keys(getTableColumns(payrollScheduleSettingsTable));
      return { rows: baselineConflict ? [] : [keys.map(key => baseline[key as keyof Schedule])] };
    }
    assert.match(query.text, /^select /i, "only SELECT or legacy baseline initialization is allowed");
    const source = sources.find(([table]) => query.text.includes(`from "${getTableName(table)}"`));
    assert.ok(source, `Unexpected SELECT: ${query.text}`);
    const [table, rows] = source;
    let result: readonly unknown[] = rows;
    if (table === payrollScheduleSettingsTable) {
      const month = String(values[0]);
      result = schedules.filter(row => row.effectiveFromMonth <= month);
      if (query.text.includes("order by")) result = [...result].sort((a, b) =>
        (b as Schedule).effectiveFromMonth.localeCompare((a as Schedule).effectiveFromMonth));
      if (query.text.includes("limit")) result = result.slice(0, 1);
    }
    const keys = Object.keys(getTableColumns(table));
    return { rows: result.map(row => keys.map(key => (row as Record<string, unknown>)[key])) };
  }) as typeof pool.query);
  return queries;
}
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
after(() => pool.end());

// Test-only historical oracle. Production never reconstructs history in a payroll GET.
function calculateThrough(month: string, data: PayrollCalculationData, schedules: Schedule[]) {
  let previous: ReturnType<typeof calculatePayrollMonth> | undefined;
  for (let current = "2016-01"; current <= month; current = nextMonth(current)) {
    previous = calculatePayrollMonth(current, { ...data, openingBalances: previous?.lines },
      selectPayrollScheduleVersion(schedules, current)!);
  }
  return previous!;
}

it("preserves complete summaries across ten years, schedule versions and salary corrections", async t => {
  const { data, schedules } = fixture();
  const before = structuredClone(data);
  const queries = fakeDatabase(t, data, schedules);
  // Golden complete responses captured from the per-month-query implementation.
  const expected = {
    "2016-01": "bb6bdf01cd61e31522bb887225160468c48aaf09d1213e01c620e96864663ccf",
    "2019-06": "3ed01b440d5e3cad41e1bf618eeb58a0fde4c5ed01b6556c60480d593da2189a",
    "2020-02": "202afa7f520700e32847a98eea752e19a18f855975d364d977c20d1c3b18132c",
    "2025-12": "dacf56d2e1833bc471476646223709c7cecf567499650f185e51d4b86ab234dd",
  };
  for (const month of Object.keys(expected) as Array<keyof typeof expected>) {
    const summary = calculateThrough(month, data, schedules);
    assert.equal(digest(summary), expected[month], `${month}: all response fields must match legacy calculation`);
    if (month === "2025-12") {
      assert.equal(summary.lines.find(line => line.employeeId === 3)?.carryoverAmount, 1190);
      assert.equal(summary.lines.find(line => line.employeeId === 3)?.balanceAmount, 1200);
      assert.equal(summary.schedule.id, 3);
      assert.equal(summary.finalPaymentDate, "2026-01-05");
    }
  }
  assert.deepEqual(data, before, "calculation must not mutate payments or inputs");
  data.salaryHistory.find(row => row.id === 11)!.baseSalary = 2_100_000;
  const corrected = calculateThrough("2025-12", data, schedules);
  assert.equal(digest(corrected), "8fd60bc83cbabcb192d76cd73556368929ac8fed1f1b8dea7602353a55f41a05");
  assert.equal(corrected.lines[0].paidAmount, 1_920_000);
  assert.equal(corrected.lines[0].secondPaidAmount, 20_000);
});

it("keeps database reads and simulated network time constant for one month versus 120 months", async t => {
  const { data, schedules } = fixture();
  const queries = fakeDatabase(t, data, schedules, 5);
  const shortStart = performance.now();
  await getPayrollSummary("2016-01", data);
  const shortMs = performance.now() - shortStart;
  const shortReads = queries.length;
  queries.length = 0;
  const longStart = performance.now();
  await getPayrollSummary("2025-12", data);
  const longMs = performance.now() - longStart;
  t.diagnostic(`one month: ${shortReads} reads, ${shortMs.toFixed(1)}ms; 120 months: ${queries.length} reads, ${longMs.toFixed(1)}ms`);
  assert.equal(shortReads, 1);
  assert.equal(queries.length, 1);
  assert.equal(queries.filter(query => query.includes('from "payroll_schedule_settings"')).length, 1);
  // Network contribution is fixed; allow generous CPU/scheduler headroom so
  // this catches sequential historical I/O without relying on microbenchmarks.
  assert.ok(longMs < shortMs + 400, `120-month calculation took ${longMs.toFixed(1)}ms`);
});

it("exports the same insurance salary from the common long-history summary", async t => {
  const { data, schedules } = fixture();
  const queries = fakeDatabase(t, data, schedules);
  const summary = calculateThrough("2025-12", data, schedules);
  const bytes = await buildInsuranceWorkbook(summary.lines, data.allEmployees);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  const sheet = workbook.worksheets[0];
  const lines = summary.lines.filter(line => line.socialInsuranceSalary > 0);
  assert.equal(sheet.rowCount, lines.length + 1);
  lines.forEach((line, index) => {
    assert.equal(sheet.getCell(`H${index + 2}`).value, line.socialInsuranceSalary);
    assert.equal(sheet.getCell(`G${index + 2}`).result, line.socialInsuranceSalary);
  });
  assert.equal(queries.length, 0);
});

it("uses one schedule read with preloaded inputs and observes edits on the next request", async t => {
  const { data, schedules } = fixture();
  const queries = fakeDatabase(t, data, schedules);
  const first = await getPayrollSummary("2025-12", data);
  assert.equal(queries.length, 1);
  schedules[2].finalPayDay = 7;
  const second = await getPayrollSummary("2025-12", data);
  assert.equal(queries.length, 2);
  assert.equal(first.finalPaymentDate, "2026-01-05");
  assert.equal(second.finalPaymentDate, "2026-01-07");
  assert.deepEqual(first.lines, second.lines);
});

for (const conflict of [false, true]) {
  it(`initializes a missing historical baseline once${conflict ? " with a concurrent initializer" : ""}`, async t => {
    const { data, schedules } = fixture();
    schedules.shift(); // Newer effective versions exist, but not for early employment.
    const queries = fakeDatabase(t, data, schedules, 0, conflict);
    const schedule = await getPayrollSchedule("2016-01");
    assert.equal(schedule.effectiveFromMonth, "0001-01");
    assert.equal(queries.length, conflict ? 3 : 2);
    assert.equal(queries.filter(query => query.startsWith("insert ")).length, 1);
    queries.length = 0;
    await getPayrollSummary("2025-12", data);
    assert.equal(queries.length, 1, "later requests reuse the stored baseline");
  });
}

it("keeps signed overpayment and the ±1 tolerance across empty-attendance months", async t => {
  const { data, schedules } = fixture();
  data.allEmployees = [data.allEmployees[2]];
  data.allAdjustments = data.allAdjustments.filter(row => row.employeeId === 3);
  data.allAdjustments.forEach(row => { row.paidAmount = 100; row.secondPaidAmount = 10; });
  fakeDatabase(t, data, schedules);
  let summary = calculateThrough("2025-12", data, schedules);
  assert.equal(summary.lines[0].carryoverAmount, -1190);
  assert.equal(summary.lines[0].balanceAmount, -1200);
  assert.equal(summary.lines[0].overpaidAmount, 1200);
  assert.equal(summary.lines[0].payable, 0);
  data.allAdjustments.forEach(row => { row.secondPaidAmount = 1; });
  summary = calculateThrough("2025-12", data, schedules);
  assert.equal(summary.lines[0].balanceAmount, 0, "round the monthly ±1 difference before carrying it");
});
