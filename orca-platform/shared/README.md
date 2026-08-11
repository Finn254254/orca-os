# @orca/shared

Canonical types, zod schemas, and small platform-agnostic utilities shared by
every Orca Platform service:

- `schemas.ts` — every cross-service wire format (nodes, metrics, commands,
  cluster config, mesh protocol messages, jobs, models, users/sessions,
  audit events, alerts/logs, realtime event envelope). Types are inferred
  from the zod schemas (`z.infer<...>`), so validation and typing can never
  drift apart.
- `jsonStore.ts` — `JsonStore<T>`: durable, atomic-write JSON persistence
  with serialized read-modify-write (`mutate`) so concurrent callers don't
  race on stale state, plus `flush()` for graceful shutdown.
- `auth.ts` — HMAC-signed token helpers (`signToken`/`verifyToken`),
  password hashing, constant-time comparison. No external JWT dependency.
- `logger.ts` — `pino`-based structured logger factory.
- `ids.ts` — id generation (`generateId(prefix)`) and ISO timestamps.

Run tests: `npx vitest run --root shared` (from `orca-platform/`).
