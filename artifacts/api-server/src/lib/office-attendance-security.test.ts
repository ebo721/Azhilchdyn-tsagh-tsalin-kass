import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";
import {
  deviceSigningText,
  enrollmentSigningText,
  isFreshTimestamp,
  isOfficeNetworkRequest,
  officeCalendarDate,
  officeClockTime,
  trustedVercelClientIp,
  verifyP256Signature,
} from "./office-attendance-security.js";

const vercelProduction = { VERCEL: "1", NODE_ENV: "production" };

describe("office Wi-Fi attendance security helpers", () => {
  it("trusts only a single syntactically valid forwarded IP on Vercel production", () => {
    assert.equal(trustedVercelClientIp({ "x-forwarded-for": "203.0.113.14" }, vercelProduction), "203.0.113.14");
    assert.equal(trustedVercelClientIp({ "x-forwarded-for": "203.0.113.14, 10.0.0.1" }, vercelProduction), null);
    assert.equal(trustedVercelClientIp({ "x-forwarded-for": ["203.0.113.14", "10.0.0.1"] }, vercelProduction), null);
    assert.equal(trustedVercelClientIp({ "x-forwarded-for": "not-an-ip" }, vercelProduction), null);
    assert.equal(trustedVercelClientIp({ "x-forwarded-for": "203.0.113.14" }, { NODE_ENV: "development" }), null);
    assert.equal(isOfficeNetworkRequest(
      { "x-forwarded-for": "8.8.8.8" },
      "8.8.8.8",
      vercelProduction,
    ), true);
    assert.equal(isOfficeNetworkRequest(
      { "x-forwarded-for": "8.8.8.9" },
      "8.8.8.8",
      vercelProduction,
    ), false);
    assert.equal(isOfficeNetworkRequest(
      { "x-forwarded-for": "8.8.8.8" },
      "192.168.1.2",
      vercelProduction,
    ), false);
  });

  it("verifies P-256 signatures for explicit canonical register and device actions", () => {
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const publicKey = pair.publicKey.export({ format: "jwk" });
    const enrollmentText = enrollmentSigningText("enrollment-token", 1234, "client-nonce-12345");
    const signedStatus = sign("sha256", Buffer.from(deviceSigningText("status", 9, 1234, "client-nonce-12345")), {
      key: pair.privateKey,
      dsaEncoding: "ieee-p1363",
    });
    const signedEnrollment = sign("sha256", Buffer.from(enrollmentText), {
      key: pair.privateKey,
      dsaEncoding: "ieee-p1363",
    });
    const key = {
      kty: publicKey.kty as "EC",
      crv: publicKey.crv as "P-256",
      x: publicKey.x!,
      y: publicKey.y!,
    };
    assert.equal(verifyP256Signature(key, deviceSigningText("status", 9, 1234, "client-nonce-12345"), signedStatus.toString("base64url")), true);
    assert.equal(verifyP256Signature(key, deviceSigningText("check-in", 9, 1234, "client-nonce-12345"), signedStatus.toString("base64url")), false);
    assert.equal(verifyP256Signature(key, enrollmentText, signedEnrollment.toString("base64url")), true);
    assert.equal(verifyP256Signature(key, enrollmentText, "invalid***"), false);
  });

  it("rejects stale and future signatures and keeps office times in Ulaanbaatar", () => {
    const now = Date.now();
    assert.equal(isFreshTimestamp(now, now), true);
    assert.equal(isFreshTimestamp(now - 5 * 60 * 1000 - 1, now), false);
    assert.equal(isFreshTimestamp(now + 5 * 60 * 1000 + 1, now), false);
    const instant = new Date("2026-10-02T16:30:00.000Z");
    assert.equal(officeCalendarDate(instant), "2026-10-03");
    assert.equal(officeClockTime(instant), "00:30");
  });
});