import assert from "node:assert/strict";
import { it } from "node:test";
import { canUseMenuApi } from "./staff-menu-access.js";

it("bank-only accountants can read source lists without gaining source mutation or detail access", () => {
  const session = { role: "accountant" as const, menuPaths: ["/bank-transactions"] };
  for (const path of ["/inventory/purchases", "/operating-expenses", "/fixed-assets"]) {
    assert.equal(canUseMenuApi(session, path, "GET"), true);
    assert.equal(canUseMenuApi(session, path + "/", "GET"), true);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      assert.equal(canUseMenuApi(session, path, method), false);
      assert.equal(canUseMenuApi(session, path + "/123", method), false);
    }
    assert.equal(canUseMenuApi(session, path + "/123", "GET"), false);
  }
  assert.equal(canUseMenuApi(session, "/inventory/items", "GET"), false);
  assert.equal(canUseMenuApi({ role: "accountant", menuPaths: ["/ar-ap"] }, "/inventory/purchases", "GET"), false);
});
