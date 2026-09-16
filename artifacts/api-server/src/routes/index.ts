import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import operationsRouter from "./operations.js";
import authRouter from "./auth.js";
import bankTransactionsRouter from "./bank-transactions.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(bankTransactionsRouter);
router.use(operationsRouter);

export default router;
