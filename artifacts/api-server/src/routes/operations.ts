import { Router, type IRouter } from "express";
import {
  CreateAttendanceBody,
  CreateShiftBody,
  CreateCashTransactionBody,
  CreateEmployeeBody,
  CopyPreviousShiftPlansBody,
  CopyPreviousShiftPlansResponse,
  ApprovePayrollAdvanceBody,
  GetDashboardResponse,
  GetHourBalanceQueryParams,
  GetHourBalanceResponse,
  GetPayrollQueryParams,
  GetPayrollResponse,
  GetPayrollAdvanceQueryParams,
  GetPayrollAdvanceResponse,
  GetCashSummaryResponse,
  ListAttendanceQueryParams,
  ListAttendanceResponse,
  ListShiftPlansQueryParams,
  ListShiftPlansResponse,
  ListShiftsResponse,
  ListCashTransactionsResponse,
  ListEmployeesResponse,
  UpsertPayrollAdjustmentBody,
  UpsertAttendanceBody,
  UpsertShiftPlanBody,
  UpdateShiftBody,
  UpdateShiftParams,
  UpdateEmployeeBody,
  UpdateEmployeeParams,
} from "@workspace/api-zod";
import { and, desc, eq } from "drizzle-orm";
import {
  attendanceTable,
  cashTransactionsTable,
  db,
  employeesTable,
  employeeShiftPlansTable,
  payrollAdjustmentsTable,
  payrollAdvanceApprovalsTable,
  shiftTemplatesTable,
} from "@workspace/db";
import { getStaffRole } from "../lib/hr-session";

const router: IRouter = Router();

router.use((req, res, next) => {
  const role = getStaffRole(req);
  if (!role) {
    res.status(401).json({ error: "Нэвтрэх шаардлагатай" });
    return;
  }
  if (role === "admin") {
    next();
    return;
  }
  const allowedPrefixes = role === "hr"
    ? ["/employees", "/attendance", "/hour-balance"]
    : ["/hour-balance", "/payroll"];
  if (allowedPrefixes.some((prefix) => req.path.startsWith(prefix))) {
    next();
    return;
  }
  res.status(403).json({ error: "Хүний нөөцийн менежер энэ хэсэгт хандах эрхгүй" });
});

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => today().slice(0, 7);
const money = (value: number) => Math.round(value * 100) / 100;
const monthlyIncomeTaxRelief = (socialInsuranceSalary: number) => {
  if (socialInsuranceSalary <= 500_000) return 20_000;
  if (socialInsuranceSalary <= 1_000_000) return 18_000;
  if (socialInsuranceSalary <= 1_500_000) return 16_000;
  if (socialInsuranceSalary <= 2_000_000) return 14_000;
  if (socialInsuranceSalary <= 2_500_000) return 12_000;
  if (socialInsuranceSalary <= 3_000_000) return 10_000;
  return 0;
};

function hoursBetween(clockIn: string, clockOut: string) {
  const [inHour, inMinute] = clockIn.split(":").map(Number);
  const [outHour, outMinute] = clockOut.split(":").map(Number);
  const start = inHour * 60 + inMinute;
  const end = outHour * 60 + outMinute;
  return Math.max(0, money((end - start) / 60));
}

function previousMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function weekdayCount(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const weekDay = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
    if (weekDay >= 1 && weekDay <= 5) count += 1;
  }
  return count;
}

async function getPayrollSummary(month: string) {
  const [employees, records, adjustments, advanceApprovals] = await Promise.all([
    db.select().from(employeesTable).where(eq(employeesTable.status, "active")),
    db.select().from(attendanceTable),
    db.select().from(payrollAdjustmentsTable).where(eq(payrollAdjustmentsTable.month, month)),
    db.select().from(payrollAdvanceApprovalsTable).where(eq(payrollAdvanceApprovalsTable.month, month)),
  ]);
  const monthRecords = records.filter((record) => String(record.date).startsWith(month));
  const adjustmentMap = new Map(adjustments.map((adjustment) => [adjustment.employeeId, adjustment]));
  const approvedAdvanceLines = Array.isArray(advanceApprovals[0]?.lines)
    ? advanceApprovals[0].lines as Array<{ employeeId: number; advanceAmount: number }>
    : [];
  const approvedAdvanceMap = new Map(approvedAdvanceLines.map((line) => [line.employeeId, Number(line.advanceAmount)]));

  const lines = employees.map((employee) => {
    const employeeRecords = monthRecords.filter((record) => record.employeeId === employee.id);
    const daysWorked = employeeRecords.filter((record) =>
      ["present", "late"].includes(record.status),
    ).length;
    const hours = money(employeeRecords.reduce((total, record) => total + Number(record.hours), 0));
    const gross =
      employee.employeeType === "shift"
        ? money(daysWorked * Number(employee.baseSalary))
        : money(Number(employee.baseSalary));
    const socialInsuranceSalary = money(Number(employee.socialInsuranceSalary));
    const socialInsurance = money(socialInsuranceSalary * 0.115);
    const taxableIncome = money(Math.max(0, socialInsuranceSalary - socialInsurance));
    const adjustment = adjustmentMap.get(employee.id);
    const calculatedIncomeTax = money(taxableIncome * 0.1);
    const taxRelief = monthlyIncomeTaxRelief(socialInsuranceSalary);
    const incomeTax = money(Math.max(0, calculatedIncomeTax - taxRelief));
    const firstHalfDaysWorked = employeeRecords.filter((record) =>
      ["present", "late"].includes(record.status) && Number(String(record.date).slice(8, 10)) <= 15
    ).length;
    const calculatedAdvance = employee.employeeType === "shift"
      ? money(firstHalfDaysWorked * Number(employee.baseSalary))
      : money(Number(employee.baseSalary) * 0.5);
    const advanceAmount = money(approvedAdvanceMap.get(employee.id) ?? calculatedAdvance);
    const manualDeduction = money(Number(adjustment?.manualDeduction ?? 0));
    const paidAmount = money(Number(adjustment?.paidAmount ?? 0));
    const deductions = money(socialInsurance + incomeTax + advanceAmount + manualDeduction);
    const payable = money(Math.max(0, gross - deductions));
    const remainingAmount = money(Math.max(0, payable - paidAmount));
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      role: employee.role,
      employeeType: employee.employeeType,
      daysWorked,
      hours,
      gross,
      socialInsuranceSalary,
      socialInsurance,
      taxableIncome,
      calculatedIncomeTax,
      taxRelief,
      incomeTax,
      advanceAmount,
      manualDeduction,
      deductions,
      payable,
      paidAmount,
      remainingAmount,
      net: payable,
    };
  });

  return {
    month,
    totalGross: money(lines.reduce((total, line) => total + line.gross, 0)),
    totalSocialInsurance: money(lines.reduce((total, line) => total + line.socialInsurance, 0)),
    totalIncomeTax: money(lines.reduce((total, line) => total + line.incomeTax, 0)),
    totalDeductions: money(lines.reduce((total, line) => total + line.deductions, 0)),
    totalNet: money(lines.reduce((total, line) => total + line.net, 0)),
    lines,
  };
}

async function getPayrollAdvanceSummary(month: string) {
  const [approval] = await db
    .select()
    .from(payrollAdvanceApprovalsTable)
    .where(eq(payrollAdvanceApprovalsTable.month, month));
  if (approval) {
    return {
      month,
      approved: true,
      approvedAt: approval.approvedAt.toISOString(),
      totalAmount: Number(approval.totalAmount),
      lines: approval.lines,
    };
  }
  const [employees, records] = await Promise.all([
    db.select().from(employeesTable).where(eq(employeesTable.status, "active")),
    db.select().from(attendanceTable),
  ]);
  const firstHalfRecords = records.filter((record) =>
    String(record.date).startsWith(month) && Number(String(record.date).slice(8, 10)) <= 15
  );
  const lines = employees.map((employee) => {
    const daysWorked = firstHalfRecords.filter((record) =>
      record.employeeId === employee.id && ["present", "late"].includes(record.status)
    ).length;
    const dailySalary = employee.employeeType === "shift" ? money(Number(employee.baseSalary)) : 0;
    const baseSalary = employee.employeeType === "office" ? money(Number(employee.baseSalary)) : 0;
    const totalSalary = employee.employeeType === "shift"
      ? money(daysWorked * dailySalary)
      : baseSalary;
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      employeeType: employee.employeeType,
      baseSalary,
      daysWorked,
      dailySalary,
      totalSalary,
      advanceAmount: employee.employeeType === "shift" ? totalSalary : money(totalSalary * 0.5),
    };
  });
  return {
    month,
    approved: false,
    totalAmount: money(lines.reduce((total, line) => total + line.advanceAmount, 0)),
    lines,
  };
}

router.get("/dashboard", async (_req, res, next) => {
  try {
    const [employees, records, transactions] = await Promise.all([
      db.select().from(employeesTable),
      db.select().from(attendanceTable),
      db.select().from(cashTransactionsTable).orderBy(desc(cashTransactionsTable.createdAt)),
    ]);
    const todayRecords = records.filter((record) => String(record.date) === today());
    const payroll = await getPayrollSummary(currentMonth());
    const balance = transactions.reduce(
      (total, transaction) =>
        total + (transaction.type === "income" ? Number(transaction.amount) : -Number(transaction.amount)),
      0,
    );
    const recentAttendance = [...records]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 3)
      .map((record) => ({
        id: `attendance-${record.id}`,
        type: "attendance",
        title: "Ирц бүртгэгдлээ",
        detail: `${record.date} · ${record.clockIn}–${record.clockOut}`,
        createdAt: String(record.createdAt),
      }));
    const recentCash = transactions.slice(0, 3).map((transaction) => ({
      id: `cash-${transaction.id}`,
      type: "cash",
      title: transaction.type === "income" ? "Орлого бүртгэгдлээ" : "Зарлага бүртгэгдлээ",
      detail: `${transaction.description} · ${money(Number(transaction.amount)).toLocaleString()}₮`,
      createdAt: String(transaction.createdAt),
    }));
    const data = GetDashboardResponse.parse({
      employeeCount: employees.filter((employee) => employee.status === "active").length,
      presentToday: todayRecords.filter((record) => ["present", "late"].includes(record.status)).length,
      monthlyPayroll: payroll.totalNet,
      cashBalance: money(balance),
      recentActivity: [...recentAttendance, ...recentCash]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5),
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/employees", async (_req, res, next) => {
  try {
    const rows = await db.select().from(employeesTable).orderBy(desc(employeesTable.id));
    res.json(ListEmployeesResponse.parse(rows.map((employee) => ({
      ...employee,
      baseSalary: Number(employee.baseSalary),
      socialInsuranceSalary: Number(employee.socialInsuranceSalary),
      joinedAt: String(employee.joinedAt),
    }))));
  } catch (error) {
    next(error);
  }
});

router.post("/employees", async (req, res, next) => {
  try {
    const input = CreateEmployeeBody.parse(req.body);
    const [employee] = await db.insert(employeesTable).values({
      ...input,
      salaryType: input.employeeType === "shift" ? "hourly" : "monthly",
    }).returning();
    res.status(201).json({
      ...employee,
      baseSalary: Number(employee.baseSalary),
      socialInsuranceSalary: Number(employee.socialInsuranceSalary),
      joinedAt: String(employee.joinedAt),
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/employees/:id", async (req, res, next) => {
  try {
    const { id } = UpdateEmployeeParams.parse(req.params);
    const input = UpdateEmployeeBody.parse(req.body);
    const update = {
      ...input,
      ...(input.employeeType ? { salaryType: input.employeeType === "shift" ? "hourly" : "monthly" } : {}),
    };
    const [employee] = await db
      .update(employeesTable)
      .set(update)
      .where(eq(employeesTable.id, id))
      .returning();
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    res.json({
      ...employee,
      baseSalary: Number(employee.baseSalary),
      socialInsuranceSalary: Number(employee.socialInsuranceSalary),
      joinedAt: String(employee.joinedAt),
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/employees/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid employee id" });
      return;
    }
    await db.delete(employeesTable).where(eq(employeesTable.id, id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/attendance/shifts", async (_req, res, next) => {
  try {
    const rows = await db.select().from(shiftTemplatesTable).orderBy(shiftTemplatesTable.startTime);
    res.json(ListShiftsResponse.parse(rows));
  } catch (error) {
    next(error);
  }
});

router.post("/attendance/shifts", async (req, res, next) => {
  try {
    const input = CreateShiftBody.parse(req.body);
    if (input.startTime === input.endTime) {
      res.status(400).json({ error: "Ээлжийн эхлэх, тарах цаг ижил байж болохгүй" });
      return;
    }
    const [shift] = await db.insert(shiftTemplatesTable).values(input).returning();
    res.status(201).json(shift);
  } catch (error) {
    next(error);
  }
});

router.patch("/attendance/shifts/:id", async (req, res, next) => {
  try {
    const { id } = UpdateShiftParams.parse(req.params);
    const input = UpdateShiftBody.parse(req.body);
    if (input.startTime === input.endTime) {
      res.status(400).json({ error: "Ээлжийн эхлэх, тарах цаг ижил байж болохгүй" });
      return;
    }
    const [shift] = await db.update(shiftTemplatesTable).set(input).where(eq(shiftTemplatesTable.id, id)).returning();
    if (!shift) {
      res.status(404).json({ error: "Ээлж олдсонгүй" });
      return;
    }
    res.json(shift);
  } catch (error) {
    next(error);
  }
});

router.delete("/attendance/shifts/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Ээлжийн дугаар буруу байна" });
      return;
    }
    const plans = await db.select().from(employeeShiftPlansTable).where(eq(employeeShiftPlansTable.shiftId, id));
    if (plans.length) {
      res.status(409).json({ error: "Энэ ээлж сарын төлөвлөгөөнд ашиглагдсан тул устгах боломжгүй" });
      return;
    }
    await db.delete(shiftTemplatesTable).where(eq(shiftTemplatesTable.id, id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/attendance/shift-plans", async (req, res, next) => {
  try {
    const { month } = ListShiftPlansQueryParams.parse(req.query);
    const [plans, employees, shifts] = await Promise.all([
      db.select().from(employeeShiftPlansTable),
      db.select().from(employeesTable),
      db.select().from(shiftTemplatesTable),
    ]);
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee.name]));
    const shiftMap = new Map(shifts.map((shift) => [shift.id, shift]));
    const rows = plans.filter((plan) => plan.date.startsWith(month)).map((plan) => {
      const shift = shiftMap.get(plan.shiftId);
      return {
        id: plan.id,
        employeeId: plan.employeeId,
        employeeName: employeeMap.get(plan.employeeId) ?? "Тодорхойгүй",
        date: plan.date,
        shiftId: plan.shiftId,
        shiftName: shift?.name ?? "Тодорхойгүй",
        startTime: shift?.startTime ?? "",
        endTime: shift?.endTime ?? "",
      };
    });
    res.json(ListShiftPlansResponse.parse(rows));
  } catch (error) {
    next(error);
  }
});

router.put("/attendance/shift-plans", async (req, res, next) => {
  try {
    const input = UpsertShiftPlanBody.parse(req.body);
    const existing = await db.select().from(employeeShiftPlansTable).where(and(
      eq(employeeShiftPlansTable.employeeId, input.employeeId),
      eq(employeeShiftPlansTable.date, input.date),
    ));
    if (input.shiftId === null) {
      if (existing[0]) await db.delete(employeeShiftPlansTable).where(eq(employeeShiftPlansTable.id, existing[0].id));
      res.json(null);
      return;
    }
    const [shift] = await db.select().from(shiftTemplatesTable).where(eq(shiftTemplatesTable.id, input.shiftId));
    const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, input.employeeId));
    if (!shift || !employee) {
      res.status(404).json({ error: "Ажилтан эсвэл ээлж олдсонгүй" });
      return;
    }
    const [plan] = existing[0]
      ? await db.update(employeeShiftPlansTable).set({ shiftId: input.shiftId }).where(eq(employeeShiftPlansTable.id, existing[0].id)).returning()
      : await db.insert(employeeShiftPlansTable).values(input as { employeeId: number; date: string; shiftId: number }).returning();
    res.json({
      id: plan.id,
      employeeId: plan.employeeId,
      employeeName: employee.name,
      date: plan.date,
      shiftId: shift.id,
      shiftName: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/attendance/shift-plans/copy-previous", async (req, res, next) => {
  try {
    const { month, overwrite } = CopyPreviousShiftPlansBody.parse(req.body);
    const sourceMonth = previousMonth(month);
    const targetDayCount = daysInMonth(month);
    const [activeEmployees, shifts, sourcePlans, targetPlans] = await Promise.all([
      db.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.status, "active")),
      db.select({ id: shiftTemplatesTable.id }).from(shiftTemplatesTable),
      db.select().from(employeeShiftPlansTable),
      db.select().from(employeeShiftPlansTable),
    ]);
    const activeEmployeeIds = new Set(activeEmployees.map(({ id }) => id));
    const validShiftIds = new Set(shifts.map(({ id }) => id));
    const eligiblePlans = sourcePlans.filter((plan) =>
      plan.date.startsWith(sourceMonth)
      && activeEmployeeIds.has(plan.employeeId)
      && validShiftIds.has(plan.shiftId)
    );
    const targetByKey = new Map(
      targetPlans
        .filter((plan) => plan.date.startsWith(month))
        .map((plan) => [`${plan.employeeId}-${plan.date}`, plan]),
    );
    let copied = 0;
    let overwritten = 0;
    let skipped = 0;
    let unavailableDates = 0;

    await db.transaction(async (tx) => {
      for (const source of eligiblePlans) {
        const day = Number(source.date.slice(8, 10));
        if (day > targetDayCount) {
          unavailableDates += 1;
          continue;
        }
        const date = `${month}-${String(day).padStart(2, "0")}`;
        const existing = targetByKey.get(`${source.employeeId}-${date}`);
        if (existing && !overwrite) {
          skipped += 1;
          continue;
        }
        if (existing) {
          await tx.update(employeeShiftPlansTable)
            .set({ shiftId: source.shiftId })
            .where(eq(employeeShiftPlansTable.id, existing.id));
          overwritten += 1;
        } else {
          await tx.insert(employeeShiftPlansTable).values({
            employeeId: source.employeeId,
            date,
            shiftId: source.shiftId,
          });
          copied += 1;
        }
      }
    });

    res.json(CopyPreviousShiftPlansResponse.parse({
      sourceMonth,
      targetMonth: month,
      copied,
      overwritten,
      skipped,
      unavailableDates,
    }));
  } catch (error) {
    next(error);
  }
});

router.get("/attendance", async (req, res, next) => {
  try {
    const query = ListAttendanceQueryParams.parse(req.query);
    const [records, employees] = await Promise.all([
      db.select().from(attendanceTable).orderBy(desc(attendanceTable.date), desc(attendanceTable.id)),
      db.select().from(employeesTable),
    ]);
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee.name]));
    const filtered = records
      .filter((record) => !query.date || String(record.date) === query.date)
      .filter((record) => !query.month || String(record.date).startsWith(query.month))
      .map((record) => ({
        ...record,
        employeeName: employeeMap.get(record.employeeId) ?? "Тодорхойгүй",
        date: String(record.date),
        hours: Number(record.hours),
      }));
    res.json(ListAttendanceResponse.parse(filtered));
  } catch (error) {
    next(error);
  }
});

router.post("/attendance", async (req, res, next) => {
  try {
    const input = CreateAttendanceBody.parse(req.body);
    const [record] = await db
      .insert(attendanceTable)
      .values({ ...input, hours: hoursBetween(input.clockIn, input.clockOut) })
      .returning();
    const [employee] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, record.employeeId));
    res.status(201).json({
      ...record,
      employeeName: employee?.name ?? "Тодорхойгүй",
      date: String(record.date),
      hours: Number(record.hours),
    });
  } catch (error) {
    next(error);
  }
});

router.put("/attendance", async (req, res, next) => {
  try {
    const input = UpsertAttendanceBody.parse(req.body);
    const selectedHours = input.status === "present" ? (input.hours ?? 8) : 0;
    const clockIn = input.clockIn ?? (input.status === "present" ? "09:00" : "00:00");
    const clockOut = input.clockOut ?? (
      input.status === "present"
        ? selectedHours === 12 ? "21:00" : "17:00"
        : "00:00"
    );
    const existing = await db
      .select()
      .from(attendanceTable)
      .where(and(
        eq(attendanceTable.employeeId, input.employeeId),
        eq(attendanceTable.date, input.date),
      ));
    const [record] = existing.length
      ? await db
          .update(attendanceTable)
          .set({ status: input.status, clockIn, clockOut, hours: selectedHours })
          .where(eq(attendanceTable.id, existing[0].id))
          .returning()
      : await db
          .insert(attendanceTable)
          .values({
            employeeId: input.employeeId,
            date: input.date,
            status: input.status,
            clockIn,
            clockOut,
            hours: selectedHours,
          })
          .returning();
    const [employee] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, record.employeeId));
    res.json({
      ...record,
      employeeName: employee?.name ?? "Тодорхойгүй",
      date: String(record.date),
      hours: Number(record.hours),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/hour-balance", async (req, res, next) => {
  try {
    const { month } = GetHourBalanceQueryParams.parse(req.query);
    const selectedMonth = month ?? currentMonth();
    const [employees, records] = await Promise.all([
      db.select().from(employeesTable).where(eq(employeesTable.status, "active")),
      db.select().from(attendanceTable),
    ]);
    const monthRecords = records.filter((record) => String(record.date).startsWith(selectedMonth));
    const lines = employees.map((employee) => {
      const employeeRecords = monthRecords.filter((record) => record.employeeId === employee.id);
      const workedRecords = employeeRecords.filter((record) =>
        ["present", "late"].includes(record.status),
      );
      return {
        employeeId: employee.id,
        employeeName: employee.name,
        role: employee.role,
        month: selectedMonth,
        totalHours: money(workedRecords.reduce((total, record) => total + Number(record.hours), 0)),
        expectedWorkDays: employee.employeeType === "office"
          ? weekdayCount(selectedMonth)
          : employee.monthlyExpectedWorkDays,
        workDays: workedRecords.length,
        eightHourDays: workedRecords.filter((record) => Number(record.hours) === 8).length,
        twelveHourDays: workedRecords.filter((record) => Number(record.hours) === 12).length,
        leaveDays: employeeRecords.filter((record) => record.status === "leave").length,
      };
    });
    res.json(GetHourBalanceResponse.parse(lines));
  } catch (error) {
    next(error);
  }
});

router.get("/payroll", async (req, res, next) => {
  try {
    const { month } = GetPayrollQueryParams.parse(req.query);
    res.json(GetPayrollResponse.parse(await getPayrollSummary(month ?? currentMonth())));
  } catch (error) {
    next(error);
  }
});

router.put("/payroll-adjustments", async (req, res, next) => {
  try {
    const input = UpsertPayrollAdjustmentBody.parse(req.body);
    const [adjustment] = await db
      .insert(payrollAdjustmentsTable)
      .values(input)
      .onConflictDoUpdate({
        target: [payrollAdjustmentsTable.employeeId, payrollAdjustmentsTable.month],
        set: {
          manualDeduction: input.manualDeduction,
          paidAmount: input.paidAmount,
          updatedAt: new Date(),
        },
      })
      .returning();
    res.json({
      employeeId: adjustment.employeeId,
      month: adjustment.month,
      taxRelief: Number(adjustment.taxRelief),
      manualDeduction: Number(adjustment.manualDeduction),
      paidAmount: Number(adjustment.paidAmount),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/payroll-advance", async (req, res, next) => {
  try {
    const { month } = GetPayrollAdvanceQueryParams.parse(req.query);
    res.json(GetPayrollAdvanceResponse.parse(await getPayrollAdvanceSummary(month ?? currentMonth())));
  } catch (error) {
    next(error);
  }
});

router.post("/payroll-advance/approve", async (req, res, next) => {
  try {
    const { month } = ApprovePayrollAdvanceBody.parse(req.body);
    const existing = await getPayrollAdvanceSummary(month);
    if (!existing.approved) {
      await db.insert(payrollAdvanceApprovalsTable).values({
        month,
        lines: existing.lines,
        totalAmount: existing.totalAmount,
      }).onConflictDoNothing();
    }
    res.json(GetPayrollAdvanceResponse.parse(await getPayrollAdvanceSummary(month)));
  } catch (error) {
    next(error);
  }
});

router.get("/cash/summary", async (_req, res, next) => {
  try {
    const transactions = await db.select().from(cashTransactionsTable);
    const summary = transactions.reduce(
      (result, transaction) => {
        const amount = Number(transaction.amount);
        const isIncome = transaction.type === "income";
        result.balance += isIncome ? amount : -amount;
        result[isIncome ? "income" : "expense"] += amount;
        if (String(transaction.date) === today()) {
          result[isIncome ? "todayIncome" : "todayExpense"] += amount;
        }
        return result;
      },
      { balance: 0, income: 0, expense: 0, todayIncome: 0, todayExpense: 0 },
    );
    res.json(GetCashSummaryResponse.parse(Object.fromEntries(
      Object.entries(summary).map(([key, value]) => [key, money(value)]),
    )));
  } catch (error) {
    next(error);
  }
});

router.get("/cash/transactions", async (_req, res, next) => {
  try {
    const rows = await db.select().from(cashTransactionsTable).orderBy(desc(cashTransactionsTable.date), desc(cashTransactionsTable.id));
    res.json(ListCashTransactionsResponse.parse(rows.map((transaction) => ({
      ...transaction,
      amount: Number(transaction.amount),
      date: String(transaction.date),
      createdAt: String(transaction.createdAt),
    }))));
  } catch (error) {
    next(error);
  }
});

router.post("/cash/transactions", async (req, res, next) => {
  try {
    const input = CreateCashTransactionBody.parse(req.body);
    const [transaction] = await db.insert(cashTransactionsTable).values(input).returning();
    res.status(201).json({
      ...transaction,
      amount: Number(transaction.amount),
      date: String(transaction.date),
      createdAt: String(transaction.createdAt),
    });
  } catch (error) {
    next(error);
  }
});

export default router;