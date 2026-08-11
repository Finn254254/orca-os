import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Lightweight HMAC-signed token helpers used for:
 *  - cluster join tokens (Agent -> Control mesh auth)
 *  - service-to-service tokens (API -> Control)
 *  - user session tokens (Dashboard/CLI -> API)
 *
 * These are intentionally simple (HMAC-SHA256, no external JWT dependency)
 * so every service can verify tokens without a shared network call.
 * Secrets are read from environment variables; never hard-coded.
 */

export function signToken(payload: Record<string, unknown>, secret: string, expiresInMs?: number): string {
  const body = { ...payload, ...(expiresInMs ? { exp: Date.now() + expiresInMs } : {}) };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string, secret: string): T | null {
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return null;
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as T & { exp?: number };
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

export function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
