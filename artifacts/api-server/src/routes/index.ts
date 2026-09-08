import { Router, type IRouter } from "express";
import healthRouter from "./health";
import operationsRouter from "./operations";
import authRouter from "./auth";
import bankTransactionsRouter from "./bank-transactions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(bankTransactionsRouter);
router.use(operationsRouter);

export default router;
