import { Router } from "express";
import { GetPartyLedgerQueryParams, GetPartyLedgerResponse } from "@workspace/api-zod";
import { getStaffSession } from "../lib/hr-session.js";
import { isValidCalendarDate } from "../lib/date-utils.js";
import { readPartyLedger } from "../lib/party-ledger.js";

const router = Router();
router.get("/ar-ap/party-ledger", async (req, res, next) => {
  try {
    const session = await getStaffSession(req);
    if (!session || !["admin", "accountant"].includes(session.role)) return void res.status(403).json({ error: "Зөвхөн админ, нягтлан харилцагчийн дэвтэр харах эрхтэй" });
    const input = GetPartyLedgerQueryParams.parse(req.query);
    if (!isValidCalendarDate(input.from) || !isValidCalendarDate(input.to) || input.from > input.to) {
      return void res.status(400).json({ error: "Эхлэх, дуусах огноо зөв бөгөөд эхлэх огноо дуусахаас хойшгүй байна" });
    }
    res.json(GetPartyLedgerResponse.parse(await readPartyLedger(input)));
  } catch (error) {
    if (error instanceof Error && "status" in error) return void res.status(Number(error.status)).json({ error: error.message });
    next(error);
  }
});
export default router;
