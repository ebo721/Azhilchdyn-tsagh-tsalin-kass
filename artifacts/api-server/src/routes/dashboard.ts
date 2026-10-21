import { Router, type IRouter } from "express";
import { GetDashboardQueryParams, GetDashboardResponse } from "@workspace/api-zod";
import { currentMonth } from "../lib/date-utils.js";
import { readDashboardSummary } from "../lib/dashboard-summary.js";

const router: IRouter = Router();

router.get("/dashboard", async (req, res, next) => {
  try {
    const { month = currentMonth() } = GetDashboardQueryParams.parse(req.query);
    if (month.startsWith("0000")) {
      res.status(400).json({ error: "Бодит сар сонгоно уу." });
      return;
    }
    res.json(GetDashboardResponse.parse(await readDashboardSummary(month)));
  } catch (error) {
    next(error);
  }
});

export default router;
