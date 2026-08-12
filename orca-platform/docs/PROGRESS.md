# Orca Platform — Progress

Last updated: 2026-08-11 (autonomous build session).

## Current phase

**Phases 1-11 complete.** Moving into Phase 12 (AI Gateway).

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

- **Phase 6 — Orca CLI**
  - `@orca/cli`: `orca login/logout` (stateless session token saved to
    `~/.orca/cli-session.json`, overridable via `--url`/`--token` or
    `ORCA_API_URL`/`ORCA_API_TOKEN` for scripted use), `status`, `nodes`,
    `node <id>`, `metrics <id>`, `services <id>`, `version`. `models`/`jobs`/
    `logs` call the real (not-yet-existing) API endpoints and surface the
    404 as a clear hint rather than a stack trace. `run`/`deploy`/`update`/
    `power`/`backup` are registered with clear "requires Phase N" messages
    (per the build instructions' explicit distinction between "implement
    useful commands including X" and "design support for Y").
  - CLI talks only to Orca API, never to Control/Agent/system services
    directly, per the build instructions.
  - Found and fixed a real bug via the e2e test: a global `--url` program
    option and a duplicate per-subcommand `--url` option on `login`
    collided, so `orca login --url ...` silently ignored the flag and fell
    back to the default `localhost:8080`. Fixed by having `login` read the
    global option instead of declaring its own.
  - Tests: 7 unit (table/byte formatting, `ApiClient` auth header + error
    surfacing) + 1 real e2e test (`tests/e2e/cli.test.ts`) that spawns the
    actual `orca` binary against real Control + API processes: login,
    status, nodes, version, and the "not implemented yet" paths.

- **Phase 7 — Orca Dashboard**
  - `@orca/dashboard`: React + Vite + TypeScript SPA, no UI framework
    dependency, plain CSS built from the dataviz skill's validated palette
    (status colors for online/offline/degraded, sequential-blue meters,
    light/dark aware). Overview (stat tiles + live node table), Nodes,
    Node detail (capabilities, live metrics with disk/CPU/RAM meters,
    services, a working "Send ping" command button), Settings (cluster
    config view + admin-only user management). Compute/Models/Jobs/Storage/
    Applications/Logs are clearly-labeled "coming in Phase N" pages, not
    fake data — consistent with the API not having those resources yet.
  - Realtime: subscribes to Orca API's `/ws`, folds `node`/`metrics` events
    into state — no client-side polling.
  - Auth: login page, stateless token in `localStorage`, route guard
    redirecting to `/login` when signed out.
  - Verified in an actual headless-browser end-to-end test
    (`tests/e2e/dashboard.test.ts`, Playwright via the pre-installed
    Chromium): logs in, waits for a real simulated Agent process to appear
    with its real status/CPU%, opens node detail and confirms real
    capabilities render — not a static mock.
  - Tests: 9 unit/component (jsdom + Testing Library: session storage,
    login success/failure, `Meter`/`StatusPill` rendering) + 1 browser e2e.

- **Phase 8 — Multi-node simulation environment + first major demo**
  - `scripts/dev-cluster.mjs` (`npm run dev:cluster`): one command starts
    Orca Control, 3 simulated Orca Agents (`sim-node-01`/`02` in the
    `default` group, `sim-node-03` in an `edge` group, each with a
    distinct CPU/RAM/GPU profile), Orca API, and Orca Dashboard; prints a
    summary with URLs and the bootstrap admin login; Ctrl+C tears
    everything down together. State persists under `data/dev-cluster/`
    (gitignored) across restarts.
  - `docker-compose.yml` + `Dockerfile`: the same topology as containers,
    for users who prefer Docker. Structurally validated with
    `docker compose config` (no Docker daemon was available in this build
    session to actually run `docker compose up` — `npm run dev:cluster` is
    the path the automated test suite exercises).
  - **Demo verified end-to-end**, twice: once manually (curl against the
    real running cluster confirmed all 3 nodes online with live CPU%), and
    once as an automated test, `tests/e2e/dev-cluster.test.ts`, which spawns
    `scripts/dev-cluster.mjs` itself (not its components individually) and
    asserts: 3 nodes appear, all online, correct names/groups, live
    (non-static) CPU metrics flowing. Combined with the Phase 7 Playwright
    browser test (login → live node table → node detail), this covers the
    "first major demo" checklist: node registration, heartbeats,
    online/offline detection, live metrics, command execution, real-time
    dashboard updates — everything except job submission/scheduling, which
    starts in Phase 9.
  - `docs/ARCHITECTURE.md` added: process topology, why Compute/Scheduler/
    Model Manager/etc. are planned as libraries mounted into Orca API
    rather than separate services, mesh protocol summary, realtime design.

- **Phase 9 — Orca Compute**
  - New `run_job` command type (added to `@orca/shared`'s `CommandTypeSchema`),
    handled by the agent (`agent/src/commands.ts`): real nodes `execFile`
    the job's command with a configurable timeout; simulated nodes never
    touch the host — they simulate timing/output (or fail on demand via
    `payload.forceFail`, used in tests).
  - `@orca/compute`: `JobStore` (durable job records), `JobService`
    (submit → schedule via `@orca/scheduler` → dispatch a `run_job` command
    via a `ControlPort` interface → poll for completion → record
    result/logs), `createJobsRouter` mounted at `/api/v1/jobs`.
  - Known limitation: cancelling a running job doesn't stop in-flight
    execution yet (no cancel command); documented in `compute/README.md`.
  - Tests: 11 (JobService scheduling/dispatch/completion/cancellation with
    a fake `ControlPort`, router request/response contract).

- **Phase 10 — Orca Scheduler**
  - `@orca/scheduler`: pure `selectNode(nodes, spec)` — hard filters
    (online, pinned node/group, required capability tags, CPU/RAM/GPU/VRAM)
    then scores by free CPU%/RAM%/temperature penalty, returns a
    human-readable reason either way (why picked, or why every node was
    rejected). Recorded on the job as `schedulingReason`.
  - Tests: 10, covering every filter and the scoring tie-breaks.

- **Phase 11 — Orca Model Manager**
  - `@orca/models`: `ModelStore` (registry), `ModelService` (pull → track
    download progress → available/error, delete, sync-from-runtime),
    mounted at `/api/v1/models`.
  - `OllamaAdapter`: real HTTP client against Ollama's documented API
    (tags/pull-with-streaming-progress/delete) — **not yet verified against
    a live Ollama instance** (none available in this environment); tested
    against a fake server matching the documented API shape. Flagged
    clearly in `models/README.md` as the first thing to sanity-check
    against a real `ollama serve`.
  - `LlamaCppAdapter`: filesystem-based (`.gguf` files in a directory) —
    fully verified with real file operations, no network dependency.
  - Scope limitation (documented): manages one configured runtime endpoint
    per adapter; per-node runtime discovery/routing across the cluster is
    AI Gateway/Scheduler territory, not solved here.
  - Tests: 21 (store, both adapters, service pull/error/delete/sync,
    router contract).

- **CLI and Dashboard updated to match**: `orca run <command...>` now
  really submits and waits for a job (was a placeholder); `orca jobs`/
  `orca job <id>` and `orca models`/`orca model-pull` are real. Dashboard's
  Jobs and Models pages show live data (2s poll) instead of "coming soon".
  Compute/Models routes and their RBAC (`admin`/`operator` to
  submit/cancel/pull/delete, any authenticated role to read) added to
  `openapi.json`.

## Partially completed / next up

- Phases 12-24: not started (see `orca-platform/README.md` for the full
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
`control` (6), `agent` (8), `compute` (11), `scheduler` (10), `models`
(21), `api` (9), `cli` (7), `dashboard` (9), `tests` e2e (5) = 103/103.

Note: `dashboard/` is intentionally **not** in the root `tsconfig.json`
`tsc -b` graph — it's a Vite/browser app with `moduleResolution: "Bundler"`
and its own `tsc --noEmit` typecheck (`npm run typecheck` in
`dashboard/`), separate from the NodeNext backend project references.
`tests/` pulls in `playwright-core` (driving the pre-installed Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) for the dashboard
browser test only — not used elsewhere.

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

1. Orca AI Gateway (Phase 12): unified inference API, OpenAI-compatible
   where practical, routing chat/completion requests to a model via
   `@orca/models` + `@orca/scheduler`.
2. Orca Deploy (Phase 13): application manifest format, container-based
   execution, `orca deploy`/`apps`/`app`/`remove`.
3. Orca Storage (Phase 14): device/pool discovery, capacity/health.
