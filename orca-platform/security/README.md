# @orca/security

Shared platform security primitives used by Orca API (and, later, other
services that need users/auth).

- `userStore.ts` — `UserStore`: durable user records (`JsonStore`-backed),
  salted+hashed passwords (never plaintext), `bootstrapAdmin` (only creates
  a user if none exist yet — no default/hard-coded credentials).
- `tokens.ts` — stateless, expiring, HMAC-signed session tokens built on
  `@orca/shared`'s `signToken`/`verifyToken`.

Run tests: `npx vitest run --root security` (from `orca-platform/`).
