import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import bankTransactionsRouter from "./bank-transactions.js";
import requireStaffAuth from "../middlewares/require-staff-auth.js";
import employeesRouter from "./employees.js";
import attendanceRouter from "./attendance.js";
import hourBalanceRouter from "./hour-balance.js";
import payrollRouter from "./payroll.js";
import cashRouter from "./cash.js";
import inventoryRouter from "./inventory.js";
import operatingExpensesRouter from "./operating-expenses.js";
import chartOfAccountsRouter from "./chart-of-accounts.js";
import deletionRequestsRouter from "./deletion-requests.js";
import dashboardRouter from "./dashboard.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(requireStaffAuth);
router.use(bankTransactionsRouter);
router.use(employeesRouter);
router.use(attendanceRouter);
router.use(hourBalanceRouter);
router.use(payrollRouter);
router.use(cashRouter);
router.use(inventoryRouter);
router.use(operatingExpensesRouter);
router.use(chartOfAccountsRouter);
router.use(deletionRequestsRouter);
router.use(dashboardRouter);

export default router;
