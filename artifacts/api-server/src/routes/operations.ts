import { Router, type IRouter } from "express";
import {
  CreateAttendanceBody,
  CreateCashTransactionBody,
  CreateEmployeeBody,
  GetDashboardResponse,
  GetHourBalanceQueryParams,
  GetHourBalanceResponse,
  GetPayrollQueryParams,
  GetPayrollResponse,
  GetCashSummaryResponse,
  ListAttendanceQueryParams,
  ListAttendanceResponse,
  ListCashTransactionsResponse,
  ListEmployeesResponse,
  UpsertPayrollAdjustmentBody,
  UpsertAttendanceBody,
  UpdateEmployeeBody,
  UpdateEmployeeParams,
} from "@workspace/api-zod";
import { and, desc, eq } from "drizzle-orm";
import {
  attendanceTable,
  cashTransactionsTable,
  db,
  employeesTable,
  payrollAdjustmentsTable,
} from "@workspace/db";

const router: IRouter = Router();

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => today().slice(0, 7);
const money = (value: number) => Math.round(value * 100) / 100;

function hoursBetween(clockIn: string, clockOut: string) {
  const [inHour, inMinute] = clockIn.split(":").map(Number);
  const [outHour, outMinute] = clockOut.split(":").map(Number);
  const start = inHour * 60 + inMinute;
  const end = outHour * 60 + outMinute;
  return Math.max(0, money((end - start) / 60));
}

async function getPayrollSummary(month: string) {
  const [employees, records, adjustments] = await Promise.all([
    db.select().from(employeesTable).where(eq(employeesTable.status, "active")),
    db.select().from(attendanceTable),
    db.select().from(payrollAdjustmentsTable).where(eq(payrollAdjustmentsTable.month, month)),
  ]);
  const monthRecords = records.filter((record) => String(record.date).startsWith(month));
  const adjustmentMap = new Map(adjustments.map((adjustment) => [adjustment.employeeId, adjustment]));

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
    const taxableIncome = money(Math.max(0, gross - socialInsurance));
    const adjustment = adjustmentMap.get(employee.id);
    const calculatedIncomeTax = money(taxableIncome * 0.1);
    const taxRelief = money(Number(adjustment?.taxRelief ?? 0));
    const incomeTax = money(Math.max(0, calculatedIncomeTax - taxRelief));
    const advanceAmount = money(gross * 0.5);
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
          taxRelief: input.taxRelief,
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