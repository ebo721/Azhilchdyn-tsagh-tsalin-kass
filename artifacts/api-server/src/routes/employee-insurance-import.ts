import { Router } from "express";
import { asc } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";
import { PreviewEmployeeInsuranceImportBody, ApplyEmployeeInsuranceImportBody,
  PreviewEmployeeInsuranceImportResponse, ApplyEmployeeInsuranceImportResponse } from "@workspace/api-zod";
import { getStaffSession } from "../lib/hr-session.js";
import { parseEmployeeInsuranceXlsx, EmployeeImportError } from "../lib/employee-insurance-xlsx.js";
import { createEmployeeImportToken, previewInsuranceRows, applyEmployeeInsuranceImport } from "../lib/employee-insurance-import.js";

const router = Router();
router.post("/employees/insurance-import/:action", async (req, res, next) => {
  try {
    const session = await getStaffSession(req);
    if (!session || !["admin", "hr", "accountant"].includes(session.role)) {
      res.status(403).json({ error: "НДШ Excel-ийг зөвхөн админ, хүний нөөц, нягтлан уншуулна." });
      return;
    }
    if (req.params.action === "preview") {
      const input = PreviewEmployeeInsuranceImportBody.parse(req.body);
      if (!/\.xlsx$/i.test(input.fileName) || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64)) throw new EmployeeImportError("НДШ-ийн .xlsx файл сонгоно уу.");
      const rows = await parseEmployeeInsuranceXlsx(Buffer.from(input.contentBase64, "base64"));
      const employees = await db.select().from(employeesTable).orderBy(asc(employeesTable.id));
      res.json(PreviewEmployeeInsuranceImportResponse.parse({ previewToken: createEmployeeImportToken(rows, employees, session.id),
        totalRows: rows.length, rows: previewInsuranceRows(rows, employees) }));
    } else if (req.params.action === "apply") {
      const input = ApplyEmployeeInsuranceImportBody.parse(req.body);
      res.json(ApplyEmployeeInsuranceImportResponse.parse(await applyEmployeeInsuranceImport(input.previewToken, input.selections, session.id)));
    } else res.sendStatus(404);
  } catch (error) {
    if (error instanceof EmployeeImportError) { res.status(error.status).json({ error: error.message }); return; }
    if (error instanceof Error && error.name === "ZodError") { next(error); return; }
    // Database errors may embed parameter values (registration/phone/profile).
    // Never pass those errors to the generic SQL-error logger.
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Employee insurance import failed");
    res.status(500).json({ error: "Мэдээллийг хадгалж чадсангүй. Өөрчлөлт хадгалагдаагүй. Дахин оролдоно уу." });
  }
});
export default router;
