import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import app from "../app.ts";
import { isExcludedBankFee } from "./bank-transactions.ts";

describe("bank statement fee filtering", () => {
  it("excludes 50₮ message notification fees", () => {
    assert.equal(isExcludedBankFee(50, "Мессэж мэдэгдэл шимтгэл"), true);
    assert.equal(isExcludedBankFee(50, "МЭССЭЖ МЭДЭГДЛИЙН ШИМТГЭЛ"), true);
  });

  it("keeps unrelated 50₮ transactions", () => {
    assert.equal(isExcludedBankFee(50, "Данс хооронд шилжүүлэг"), false);
    assert.equal(isExcludedBankFee(50, "Мессэж мэдэгдэл"), false);
  });
});

describe("bank transaction route", () => {
  let server: Server;
  let baseUrl: string;

  before(() => {
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => server.close());

  it("requires a staff session for statements, cash matching, transfers, and XLSX imports", async () => {
    const [list, suggestions, transfer, link, importFile] = await Promise.all([
      fetch(`${baseUrl}/api/bank-transactions`),
      fetch(`${baseUrl}/api/bank-transactions/1/cash-suggestions`),
      fetch(`${baseUrl}/api/bank-transactions/1/transfer-to-cash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: "Бусад" }),
      }),
      fetch(`${baseUrl}/api/bank-transactions/1/link-cash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cashTransactionId: 1 }),
      }),
      fetch(`${baseUrl}/api/bank-transactions/import`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array([0x50, 0x4b]),
      }),
    ]);
    assert.equal(list.status, 401);
    assert.equal(suggestions.status, 401);
    assert.equal(transfer.status, 401);
    assert.equal(link.status, 401);
    assert.equal(importFile.status, 401);
  });
});