import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { AddressInfo } from "node:net";
import ExcelJS from "exceljs";
import { db, pool, usersTable } from "@workspace/db";
import app from "../app.js";
import { createStaffSession, hrCookie } from "../lib/hr-session.js";
import { insuranceUploadHeaders } from "../lib/social-insurance-report.js";
import type { EmployeeInsuranceImportPreview } from "@workspace/api-zod";

after(() => pool.end());
test("employee identity XLSX preview, explicit matching and atomic metadata-only persistence", async t => {
  if (process.env.PRODUCTION_DATABASE_URL && process.env.DATABASE_URL === process.env.PRODUCTION_DATABASE_URL) throw new Error("Production fixture writes are forbidden");
  const schema = `employee_import_${Date.now()}`;
  const client = await pool.connect();
  const query = client.query.bind(client);
  const server = app.listen(0);
  await query(`CREATE SCHEMA ${schema}`);
  try {
    for (const table of ["users", "employees", "employee_salary_history", "payroll_adjustments", "payroll_advance_approvals"]) {
      await query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    await query(`SET search_path TO ${schema}`);
    const statements: string[] = [];
    const audited = ((config: { text: string } | string, values?: unknown[]) => {
      statements.push(typeof config === "string" ? config : config.text);
      return query(config as never, values as never);
    }) as typeof client.query;
    t.mock.method(pool, "connect", (() => Promise.resolve({ query: audited, release() {} } as unknown as typeof client)) as typeof pool.connect);
    t.mock.method(pool, "query", audited as typeof pool.query);
    for (const [index, role] of ["admin", "hr", "accountant", "viewer", "warehouse", "technologist"].entries()) {
      await query("INSERT INTO users (id,username,normalized_username,role,password_hash) VALUES ($1,$2,$2,$3,'invalid-test-hash')",
        [index + 1, `fixture-${role}`, role]);
    }
    await query(`INSERT INTO employees (id,name,role,phone,employee_type,salary_type,base_salary,social_insurance_salary,payroll_tax_exempt,joined_at,bank_account_number)
      VALUES (1,'Э.Тест','Test','99000000','office','monthly',2500000,1000000,false,'2026-09-01','00001234'),
      (2,'Э.Тест','Test','99111111','shift','monthly',1800000,1000000,false,'2026-09-01','00005678')`);
    await query(`INSERT INTO employee_salary_history (id,employee_id,effective_from,employee_type,salary_type,base_salary)
      VALUES (1,1,'2026-09-01','office','monthly',2500000),(2,2,'2026-09-01','shift','monthly',1800000)`);
    await query("INSERT INTO payroll_adjustments (id,employee_id,month,paid_amount) VALUES (1,1,'2026-10',100000)");
    await query(`INSERT INTO payroll_advance_approvals (id,month,lines,total_amount,approval_date)
      VALUES (1,'2026-10','[{"employeeId":1,"advanceAmount":50000,"paid":true}]',50000,'2026-10-20')`);
    const users = await db.select().from(usersTable);
    const cookies = new Map(users.map(user => [user.role, `${hrCookie.name}=${createStaffSession(user)}`]));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/employees/insurance-import`;
    const request = (action: string, body: unknown, role = "admin") => fetch(`${base}/${action}`, {
      method: "POST", headers: { Cookie: cookies.get(role)!, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    async function file(second = false) {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("data");
      sheet.addRow([...insuranceUploadHeaders]);
      sheet.addRow(["ТТ00123456", "УРГИЙН", "ЭЦГИЙН", "ТЕСТ", "01001", "1120-11", 9999999, 9999999, 0, 0, 0, 0, "Монгол", "", "empty"]);
      if (second) sheet.addRow(["АА00123456", "УРГИЙН", "ӨӨР", "ӨӨР", "01001", "1120-11", 9999999, 9999999, 0, 0, 0, 0, "Монгол", "", "empty"]);
      return { fileName: "fixture.xlsx", contentBase64: Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64") };
    }
    const financial = async () => ({
      salary: (await query("SELECT * FROM employee_salary_history ORDER BY id")).rows,
      adjustments: (await query("SELECT * FROM payroll_adjustments ORDER BY id")).rows,
      approvals: (await query("SELECT * FROM payroll_advance_approvals ORDER BY id")).rows,
      settings: (await query("SELECT id,name,role,base_salary,social_insurance_salary,payroll_tax_exempt,joined_at,bank_account_number FROM employees ORDER BY id")).rows,
    });
    const beforeFinance = await financial();
    let preview: EmployeeInsuranceImportPreview;
    await t.test("preview reads the file but never writes or picks the first identical name", async () => {
      statements.length = 0;
      const response = await request("preview", await file());
      assert.equal(response.status, 200, await response.clone().text());
      preview = await response.json() as EmployeeInsuranceImportPreview;
      assert.equal(preview.rows[0].status, "ambiguous");
      assert.equal(preview.rows[0].suggestedEmployeeId, null);
      assert.equal(preview.rows[0].candidates.length, 2);
      assert.equal(statements.some(s => /\b(insert into|update |delete from)\b/i.test(s)), false);
    });
    await t.test("unresolved rows cannot save; explicit selection persists identity and preserves all payroll inputs", async () => {
      assert.equal((await request("apply", { previewToken: preview.previewToken, selections: [] })).status, 409);
      const response = await request("apply", { previewToken: preview.previewToken, selections: [{ rowNumber: 2, employeeId: 2 }] });
      assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual(await response.json(), { updated: 1, skipped: 0, unchanged: 0 });
      const rows = (await query("SELECT id,social_insurance_profile,phone FROM employees ORDER BY id")).rows;
      assert.equal(rows[0].social_insurance_profile, null);
      assert.equal(rows[1].social_insurance_profile.parentName, "ЭЦГИЙН");
      assert.equal(rows[1].social_insurance_profile.givenName, "ТЕСТ");
      assert.equal(rows[1].social_insurance_profile.registrationNumber, "ТТ00123456");
      assert.equal(rows[1].phone, "99111111");
      assert.deepEqual(await financial(), beforeFinance);
      const repeated = await request("apply", { previewToken: preview.previewToken, selections: [{ rowNumber: 2, employeeId: 2 }] });
      assert.equal(repeated.status, 409); // The old roster fingerprint cannot overwrite newer data.
    });
    await t.test("admin, HR and accountant may import; forbidden roles and path variants cannot", async () => {
      for (const role of ["admin", "hr", "accountant"]) assert.equal((await request("preview", await file(), role)).status, 200);
      for (const role of ["viewer", "warehouse", "technologist"]) {
        for (const path of ["preview", "preview/", "apply", "apply/"]) assert.equal((await request(path, {}, role)).status, 403);
      }
      const anonymous = await fetch(`${base}/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      assert.equal(anonymous.status, 401);
    });
    await t.test("invalid file and tampered preview fail without changing employee records", async () => {
      assert.equal((await request("preview", { fileName: "bad.xlsx", contentBase64: "aW52YWxpZA==" })).status, 422);
      assert.equal((await request("apply", { previewToken: `${preview.previewToken}x`, selections: [{ rowNumber: 2, employeeId: 1 }] })).status, 422);
      assert.deepEqual(await financial(), beforeFinance);
    });
    await t.test("a database failure on the second update rolls back the first update as well", async () => {
      const response = await request("preview", await file(true));
      const pending = await response.json() as EmployeeInsuranceImportPreview;
      const before = (await query("SELECT * FROM employees ORDER BY id")).rows;
      await query(`CREATE FUNCTION ${schema}.reject_second_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.id=2 THEN RAISE EXCEPTION 'fixture import failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_import BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_second_update()`);
      const saved = await request("apply", { previewToken: pending.previewToken, selections: [{ rowNumber: 2, employeeId: 1 }, { rowNumber: 3, employeeId: 2 }] });
      assert.equal(saved.status, 500);
      assert.deepEqual((await query("SELECT * FROM employees ORDER BY id")).rows, before);
      await query("DROP TRIGGER reject_import ON employees");
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    t.mock.restoreAll();
    await query("RESET search_path");
    await query(`DROP SCHEMA ${schema} CASCADE`);
    client.release();
  }
});
