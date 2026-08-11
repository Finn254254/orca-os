# Orca Platform — Progress

Last updated: 2026-08-11 (autonomous build session).

## Current phase

Phases 1-5 complete (scaffolding, shared libs, mesh, Control, Agent,
end-to-end wiring, Orca API + security). Moving into Phase 6 (Orca CLI).

## Completed

- **Phase 1 — Scaffolding & shared libs**
  - `orca-platform/` monorepo (npm workspaces, TypeScript, `tsx` for dev,
    `vitest` for tests, `tsc -b` project references for whole-platform
    typechecking).
  - `@orca/shared`: zod schemas for every core domain object (nodes,
    capabilities, metrics, commands, cluster config, jobs, models, users,
    sessions, audit events, alerts, logs, realtime event envelope) with
    inferred TS types as the single source of truth for wire formats.
    HMAC token signing/verification (`signToken`/`verifyToken`), password
    hashing, atomic-write `JsonStore<T>` for durable JSON persistence with
    serialized read-modify-write semantics and a `flush()` for graceful
    shutdown. Structured logging via `pino`. Tests: 7 passing.
  - `@orca/mesh`: the Agent<->Control communication layer. `MeshServer`
    (server-side, wraps `ws` over an existing HTTP server, token-authenticated
    `hello`/`heartbeat`/`command`/`command_result`/`ack`/`error` protocol) and
    `MeshClient` (client-side, automatic reconnect with exponential backoff +
    jitter). Tests: 4 passing (registration, bad-token rejection, heartbeat +
    command round-trip, disconnect detection).

- **Phase 2 — Orca Control**
  - `@orca/control`: authoritative cluster state service.
    - `ClusterStore`: node registry (identity, name, group, capabilities,
      status, last metrics, services, labels), persistent `ClusterConfig`
      (cluster name, groups, heartbeat interval/timeout, settings), command
      records, all durably persisted via `JsonStore` and restart-safe.
    - Health sweeper: marks nodes offline when their heartbeat exceeds the
      configured timeout (backstop for missed disconnect events).
    - Immediate offline detection on mesh disconnect (in addition to the
      sweeper), so "turn a simulated node off" reflects in cluster state
      right away.
    - REST API under `/api/v1`: `GET/PUT /cluster/config`,
      `GET/POST /cluster/groups`, `GET /nodes`, `GET /nodes/:id`,
      `GET /nodes/:id/metrics`, `GET/POST /nodes/:id/commands`,
      `GET /commands`, `GET /commands/:id`.
    - Graceful shutdown: closes mesh sockets, waits for their disconnect
      handlers to run, flushes the store, then closes the HTTP server — no
      lost writes on `SIGTERM`/`SIGINT`.
    - Tests: 6 passing (empty state, registration + heartbeat + HTTP
      visibility, offline-on-disconnect, command delivery + result
      round-trip, unknown-node command rejection, persistence across
      restart).

- **Phase 3 — Orca Agent**
  - `@orca/agent`: per-node daemon. `MetricsProvider` interface with two
    implementations — `RealMetricsProvider` (via `systeminformation`: CPU,
    RAM, disk, network, GPU where present, CPU temperature, OS info, uptime;
    verified working against this container's real host) and
    `SimulatedMetricsProvider` (schema-valid, jittered synthetic metrics for
    the multi-node dev cluster, with a tunable profile — CPU cores, RAM,
    optional GPU).
  - Node identity persisted to disk (`identity.json`) so restarts keep the
    same node id.
  - Command execution: `ping`, `start_service`/`stop_service`/
    `restart_service` (via `systemctl`), `shell` (opt-in via
    `ORCA_ALLOW_SHELL_COMMANDS`, off by default), `power` (opt-in via
    `ORCA_ALLOW_POWER_COMMANDS`; simulated nodes always simulate it so the
    dev cluster can never actually reboot the host machine).
  - Tests: 6 passing (capabilities/metrics/services schema validity, ram
    bounds under repeated sampling, registration + heartbeat delivery
    against a real `MeshServer`, ping round-trip, shell-disabled-by-default,
    simulated power command).

- **Phase 4 — End-to-end wiring**
  - `orca-platform/tests` workspace: a true end-to-end test
    (`tests/e2e/control-agent.test.ts`) that spawns **real** `orca-control`
    and `orca-agent` child processes (via `tsx`, not in-process doubles) and
    drives them over HTTP/WebSocket exactly as they'd run in the dev
    cluster: registration, live metrics appearing over HTTP, a `ping`
    command round-trip against the real agent process, and offline
    detection when the agent process is killed.
  - Found and fixed a real bug this test caught: `SimulatedMetricsProvider`
    merged its profile with `{...DEFAULT_PROFILE, ...profile}`, and
    `agent/src/index.ts` was passing explicit `cpuCores: undefined` /
    `ramTotalBytes: undefined` for unset env vars — object spread lets a
    later explicit `undefined` clobber an earlier default, so simulated
    nodes were silently registering with no CPU/RAM capabilities. Fixed by
    filtering `undefined` overrides out before merging. Also fixed a pino
    logging call (`warn("msg", extraArg)`) that was silently swallowing the
    mesh client's error text, which is what made the original bug hard to
    see in the first place.

- **Phase 5 — Orca API**
  - `@orca/security`: durable `UserStore` (salted+hashed passwords, no
    plaintext, admin bootstrap only when no users exist yet — never a
    hard-coded default account) and stateless HMAC-signed session tokens.
  - `@orca/api`: versioned REST under `/api/v1` — `auth` (login/me),
    `users` (admin-only CRUD), `nodes`/`nodes/:id`/`nodes/:id/metrics`/
    `nodes/:id/commands` (proxying Control, command POST requires
    admin/operator role), `commands`, `cluster/config`, `cluster/groups`.
    Realtime `/ws` WebSocket broadcasting `node`/`metrics` events (sourced
    by polling Control and diffing — `job`/`log`/`alert` channels will
    light up once those subsystems exist). Hand-maintained OpenAPI document
    at `/api/v1/openapi.json`, kept in sync with each route file.
  - Auth: every route but `/auth/login`, `/health`, `/openapi.json`
    requires a bearer session token; role-based access via `requireRole`.
  - Tests: 6 passing (admin bootstrap + session token, invalid credentials,
    401 without auth, Control-proxied node visibility after a real mesh
    registration, role enforcement for commands/users, OpenAPI served).

## Partially completed / next up

- Phases 6-24: not started (see `orca-platform/README.md` for the full
  component list and the top-level build instructions for phase ordering).
  Note: `models`/`jobs`/`storage`/`apps`/`logs` REST resources are
  intentionally *not* in the API yet — they'll be added alongside the
  Compute/Scheduler/Model Manager/Deploy/Storage subsystems that back them
  (Phases 9-14), rather than stubbed out now with no real implementation
  behind them.

## Tests

Run `npm test` from `orca-platform/` (or `npx vitest run --root <package>`
per package). Run `npx tsc -b tsconfig.json` from `orca-platform/` to
typecheck every package that's been added to the root `tsconfig.json`
references list — **remember to add new packages to that references array
as they're created**, or they silently won't be typechecked as part of the
whole-platform build.

All tests currently green: `shared` (7), `mesh` (4), `security` (6),
`control` (6), `agent` (6), `api` (6), `tests` e2e (1) = 36/36.

## Known limitations

- Persistence is a single JSON file per service (no concurrent-writer
  story beyond in-process serialization) — fine for the MVP/simulation
  scale this phase targets, called out explicitly as an MVP choice per the
  build instructions ("don't build complicated infra prematurely").
- No TLS/encryption on the mesh WebSocket yet (auth is token-based over
  plaintext `ws://` for now); `wss://` + certificate handling is deferred to
  the Security phase.
- Express 5's route params are typed `string | string[]` (repeating params
  support); Control's and API's HTTP layers narrow with a small `param()`
  helper since none of their routes use repeating params.
- Session tokens are stateless (self-verifying HMAC, expiring) with no
  server-side session store — logout is client-side only, no revocation
  list yet. Fine for the MVP; revisit alongside the broader Security phase.
- Orca API's realtime channel is poll-and-diff against Control (not a
  push-based event bus across process boundaries) — simple and reliable for
  MVP scale; would need revisiting for a large cluster.

## Architecture decisions

- One monorepo, one `@orca/shared` schema package as the single source of
  truth for every cross-service message shape — avoids drift between
  Agent/Control/API/CLI/Dashboard.
- Mesh protocol is a small explicit discriminated union (not a generic
  RPC framework) — easy to reason about, easy to extend.
- Every service's config is env-var driven with no hard-coded secrets;
  `ORCA_CLUSTER_TOKEN` is required (the process throws on startup if unset)
  rather than defaulting to a guessable value.

## OS integration requirements

See `orca-platform/docs/OS_INTEGRATION.md`.

## Next work

1. Orca CLI (Phase 6): `orca status/nodes/node/metrics/models/jobs/logs/
   services/version` talking to Orca API.
2. Orca Dashboard (Phase 7): React admin UI over Orca API + `/ws`.
3. Multi-node simulation environment + first demo (Phase 8).
