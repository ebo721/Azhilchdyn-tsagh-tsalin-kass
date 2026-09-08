import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import app from "../app.ts";

describe("bank transaction route", () => {
  let server: Server;
  let baseUrl: string;

  before(() => {
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => server.close());

  it("requires a staff session for statements, suggestions, and XLSX imports", async () => {
    const [list, suggestions, importFile] = await Promise.all([
      fetch(`${baseUrl}/api/bank-transactions`),
      fetch(`${baseUrl}/api/bank-transactions/1/cash-suggestions`),
      fetch(`${baseUrl}/api/bank-transactions/import`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array([0x50, 0x4b]),
      }),
    ]);
    assert.equal(list.status, 401);
    assert.equal(suggestions.status, 401);
    assert.equal(importFile.status, 401);
  });
});