import { signToken, verifyToken } from "@orca/shared";
import type { PublicUser } from "./userStore.js";

export interface SessionPayload {
  userId: string;
  username: string;
  role: string;
  [key: string]: unknown;
}

const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Session tokens are stateless (HMAC-signed, self-verifying, expiring) —
 * no server-side session store to keep in sync. This means logout is
 * client-side only for now (documented limitation; see security/README.md).
 */
export function createSessionToken(user: PublicUser, secret: string, ttlMs = DEFAULT_SESSION_TTL_MS): string {
  const payload: SessionPayload = { userId: user.id, username: user.username, role: user.role };
  return signToken(payload, secret, ttlMs);
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  return verifyToken<SessionPayload>(token, secret);
}
