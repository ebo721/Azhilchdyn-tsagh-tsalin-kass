import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { isIP } from "node:net";

const TIME_WINDOW_MS = 5 * 60 * 1000;
const OFFICE_TIME_ZONE = "Asia/Ulaanbaatar";

export function trustedVercelClientIp(
  headers: Record<string, string | string[] | undefined>,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  // Never trust X-Forwarded-For from the Replit proxy, local tools, or a non-Vercel
  // deployment. On Vercel this value is supplied directly by the edge.
  if (environment["VERCEL"] !== "1" || environment["NODE_ENV"] !== "production") return null;
  const forwarded = headers["x-forwarded-for"];
  if (typeof forwarded !== "string" || forwarded.length === 0 || forwarded.includes(",")) return null;
  if (forwarded.trim() !== forwarded || isIP(forwarded) === 0) return null;
  return forwarded.toLowerCase();
}

export function normalizeConfiguredIp(value: string): string | null {
  if (value.trim() !== value || value.includes(",") || isIP(value) === 0) return null;
  if (isIP(value) === 4) {
    const octets = value.split(".").map(Number);
    const [first, second, third] = octets;
    const nonPublic = first === 0
      || first === 10
      || first === 127
      || first >= 224
      || (first === 100 && second! >= 64 && second! <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second! >= 16 && second! <= 31)
      || (first === 192 && second === 0 && third === 0)
      || (first === 192 && second === 0 && third === 2)
      || (first === 192 && second === 168)
      || (first === 198 && (second === 18 || second === 19))
      || (first === 198 && second === 51 && third === 100)
      || (first === 203 && second === 0 && third === 113);
    return nonPublic ? null : value;
  }
  const firstGroup = value.split(":").find(Boolean);
  const firstNumber = firstGroup ? Number.parseInt(firstGroup, 16) : NaN;
  if (!Number.isInteger(firstNumber) || firstNumber < 0x2000 || firstNumber > 0x3fff) return null;
  if (/^2001:0?db8:/i.test(value)) return null;
  return value.toLowerCase();
}

export function isOfficeNetworkRequest(
  headers: Record<string, string | string[] | undefined>,
  officeIp: string | null | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const clientIp = trustedVercelClientIp(headers, environment);
  const configuredIp = officeIp ? normalizeConfiguredIp(officeIp) : null;
  return clientIp !== null && configuredIp !== null && clientIp === configuredIp;
}

export function isFreshTimestamp(timestamp: number, now = Date.now()): boolean {
  return Number.isSafeInteger(timestamp) && Math.abs(now - timestamp) <= TIME_WINDOW_MS;
}

export function nonceDigest(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex");
}

export function enrollmentSigningText(token: string, timestamp: number, nonce: string): string {
  return `office-attendance-v1\nregister\n${timestamp}\n${nonce}\n${token}`;
}

export function deviceSigningText(
  action: "status" | "check-in" | "check-out",
  deviceId: number,
  timestamp: number,
  nonce: string,
): string {
  return `office-attendance-v1\n${action}\n${deviceId}\n${timestamp}\n${nonce}`;
}

export function verifyP256Signature(
  publicKey: { kty: "EC"; crv: "P-256"; x: string; y: string },
  message: string,
  signature: string,
): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(signature)) return false;
  const signatureBytes = Buffer.from(signature, "base64url");
  if (signatureBytes.length !== 64) return false;
  try {
    const key = createPublicKey({ key: publicKey, format: "jwk" });
    return verifySignature(
      "sha256",
      Buffer.from(message, "utf8"),
      { key, dsaEncoding: "ieee-p1363" },
      signatureBytes,
    );
  } catch {
    return false;
  }
}

function zonedParts(instant: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: OFFICE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function officeCalendarDate(instant: Date): string {
  const parts = zonedParts(instant);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function officeClockTime(instant: Date): string {
  const parts = zonedParts(instant);
  return `${parts.hour}:${parts.minute}`;
}