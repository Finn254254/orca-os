# Orca Platform Security

Consolidated reference for how auth, secrets, and audit work across the
platform today, and what's explicitly deferred.

## Identity & authentication

- **Users** (`@orca/security`'s `UserStore`): salted+hashed passwords
  (never plaintext), roles `admin`/`operator`/`viewer`. The only seeded
  account is an optional bootstrap admin from `ORCA_ADMIN_USERNAME`/
  `ORCA_ADMIN_PASSWORD` — created only if no users exist yet, never a
  hard-coded default.
- **Sessions**: stateless HMAC-signed tokens (`ORCA_SESSION_SECRET`), no
  server-side session store. **Known limitation**: no revocation list yet,
  so logout is client-side only (token remains valid until it expires).
- **Node identity**: a node's id is generated once and persisted locally
  (`agent/src/identity.ts`), reused across restarts so Control doesn't
  treat a restarted node as new.
- **Mesh auth** (Agent ↔ Control): a shared cluster token
  (`ORCA_CLUSTER_TOKEN`) presented in the `hello` message. Required — every
  service that needs one throws on startup if it's unset rather than
  defaulting to something guessable.
- **Service auth** (Orca API ↔ Orca Control): **opt-in**. By default
  Control's REST API assumes a trusted internal network (no auth), as it
  always has. Set `ORCA_CONTROL_SERVICE_TOKEN` on Control and the same
  value on Orca API to require a Bearer token on every Control request
  except `/health`. See `control/src/serviceAuth.ts`.

## Authorization

Role-based access control at the Orca API layer (`requireRole` middleware,
per-route): `admin`/`operator` for mutating actions (commands, jobs,
deployments, models, rollouts, backups, cluster config), any authenticated
role for reads, `admin`-only for user management and the audit log.

## Secrets

Every secret is an environment variable with no hard-coded default:
`ORCA_CLUSTER_TOKEN`, `ORCA_SESSION_SECRET`, `ORCA_CONTROL_SERVICE_TOKEN`
(optional), `ORCA_UPDATE_SIGNING_KEY` (optional — update manifest
signing). Services that require a secret throw a clear startup error
naming the missing env var rather than falling back to something
insecure.

## Audit events

Every non-`GET` request to Orca API's `/api/v1/*` is recorded
automatically (`api/src/middleware/audit.ts`) — actor (username+role, or
the attempted username for a failed/successful login, or "anonymous"),
action (method + path), status. Retrieve via `GET /api/v1/audit`
(admin-only). This is deliberately a blanket middleware rather than
hand-added calls in each route file, so new mutating endpoints are audited
automatically without remembering to wire it in.

## Update manifest signing

HMAC-SHA256 over `version|artifactUrl|checksum` (`update/src/signing.ts`)
— single-signer tamper-evidence, not a full asymmetric PKI. Documented
there as the thing to upgrade if Orca ever needs third-party-published
releases verified without holding the signing secret.

## Known gaps / deferred

- **TLS on the mesh** (`wss://`) and on Control's/API's HTTP servers:
  plaintext today. Needs certificate provisioning and distribution across
  nodes, which is more naturally an Orca OS/Hardware Daemon concern once
  physical nodes exist (see `docs/OS_INTEGRATION.md`) — revisit then.
- **Session revocation**: no denylist; see above.
- **Cluster-wide Hardware Daemon routing**: same per-node-endpoint-
  discovery gap noted in `hardware-daemon/README.md` — not a security gap
  per se, but relevant if/when that's wired up (it'll need its own auth
  story, likely mirroring the Control service-token pattern).

## Where to look

- `security/README.md`, `security/src/` — users, sessions, audit log.
- `control/src/serviceAuth.ts` — Control's opt-in service-token check.
- `api/src/middleware/auth.ts`, `api/src/middleware/audit.ts` — API's auth
  and audit middleware.
