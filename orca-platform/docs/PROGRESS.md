# Orca Platform — Progress

Last updated: 2026-08-12 (autonomous build session).

## Current phase

**Phases 1-21 complete.** Moving into Phase 22 (full integration tests).

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

- **Phase 12 — Orca AI Gateway**
  - `@orca/ai-gateway`: `AiGatewayService` routes chat completions to
    whichever runtime a model is registered under (`@orca/models`), then
    forwards to that runtime's OpenAI-compatible `/v1/chat/completions`
    endpoint — both Ollama and llama.cpp's server expose one natively, so
    the gateway is a thin, honest proxy rather than a reimplementation.
    Non-streaming responses are parsed and returned; streaming responses
    are proxied byte-for-byte so OpenAI-SDK clients work unmodified.
  - Mounted at `/api/v1/ai` (`GET /models`, `POST /chat/completions`,
    OpenAI-style error envelope).
  - Tests: 9 unit (fake OpenAI-compatible upstream server, covering
    listing, unregistered-model/no-endpoint errors, non-streaming +
    streaming proxying, upstream-error passthrough) + 3 through the real
    API server (pull a model via the real Model Manager pipeline, chat
    through the real HTTP stack to a fake Ollama upstream, list models,
    404 on an unregistered model).
  - Same scope limitation as Model Manager: routes to one configured
    endpoint per runtime, not per-node; documented in
    `ai-gateway/README.md`.

- **Phase 13 — Orca Deploy**
  - `shared`: `AppManifestSchema`/`AppDeploymentSchema` (name, version,
    image, ports, volumes, env, resources, `targetCapabilities`,
    `targetNodeId`/`targetGroup`, `restartPolicy`); new `deploy_app`/
    `remove_app` command types. Agent handles both — real nodes run
    `docker run -d --name ... --restart ...` / `docker rm -f`; simulated
    nodes simulate without touching the host, matching the `run_job`
    pattern.
  - `@orca/scheduler` generalized: `selectNode` now takes a
    `SchedulableSpec` (the four fields it actually needs) instead of the
    Compute-specific `JobSpec`, so both `JobSpec` and `AppManifest`
    structurally satisfy it — one scheduler serves both subsystems with no
    package depending on the other's schema.
  - `@orca/deploy`: `AppStore` + `DeployService` (submit → schedule →
    dispatch `deploy_app` → poll → record container id; `removeApp`
    dispatches `remove_app` and marks `stopped`), mounted at
    `/api/v1/apps`.
  - CLI: `orca deploy <manifest.json>`, `orca apps`, `orca app <id>`,
    `orca remove <id>` — all real now (previously placeholders). Dashboard
    Applications page shows live deployments with a working Remove button.
  - Tests: 11 (DeployService scheduling/dispatch/completion/removal with a
    fake ControlPort, router contract) + a real end-to-end test in
    `api.test.ts` (deploy → run → remove through a real dispatched node)
    + a real CLI e2e test spawning the actual binary through the full
    deploy/apps/app/remove lifecycle against live Control+API+Agent
    processes.

- **Phase 14 — Orca Storage**
  - `@orca/storage`: device discovery needed **no new agent work** — Orca
    Agent already reports each node's disks in heartbeat metrics, so
    `StorageService.listDevices()` just aggregates what's already flowing
    through Control. `GET /api/v1/storage/capacity` sums that
    cluster-wide. Device health is a simple usage-threshold heuristic
    (documented limitation — no SMART data until Hardware Daemon exists).
  - Storage pools (named node groupings) and named locations
    (`model`/`dataset`/`app-data`/`backup` → node + path) are Storage's
    own small registry — `GET/POST /pools`, `GET/POST /locations`
    (filterable), `DELETE` for both.
  - Explicitly out of scope (documented): pooling raw capacity across
    nodes into one distributed filesystem — this phase tracks/labels where
    things live today, per the build instructions' guidance not to build
    a new distributed filesystem prematurely.
  - Dashboard Storage page shows live capacity + per-device health.
  - Tests: 11 (device aggregation, health thresholds, capacity math, pools
    and locations CRUD, router contract).

- **Phase 15 — Orca Hardware Daemon**
  - `@orca/hardware-daemon`: `HardwareBackend` interface (temperatures,
    fans, power, LEDs, buttons, watchdog) with `SimulatedHardwareBackend`
    as the only implementation today — evolving, plausible state (fans
    drift toward target RPM, temperature responds to fan speed) rather
    than static numbers. Its own small HTTP API (`/api/v1/temperatures`,
    `/fans`, `/power`, `/leds`, `/buttons`, `/watchdog/*`).
  - Deliberately **not** wired into Orca API/CLI/Dashboard cluster-wide
    yet — same per-node-endpoint-discovery gap already documented for
    Model Manager/AI Gateway. Delivers exactly what this phase asked for
    (the abstraction + simulator so the rest of the platform isn't
    blocked on physical hardware); cluster-wide routing is follow-up work.
  - Tests: 16 (backend state transitions including watchdog expiry via
    fake timers, full HTTP API contract).

- **Phase 16 — Orca Update**
  - `shared`: `UpdateManifest`/`Rollout` schemas; new `apply_update`/
    `rollback_update` command types. Agent shells out to a pluggable
    `orca-os-updater` binary (`ORCA_OS_UPDATER_BIN`) and — since that
    binary doesn't exist yet — falls back to a **logging-only success**
    when it's missing (`ENOENT`), exactly the "pluggable installer
    interface with a logging-only default" documented in
    `OS_INTEGRATION.md`. Simulated nodes simulate, matching every other
    dispatched-command subsystem.
  - `@orca/update`: HMAC-signed manifests (MVP tamper-evidence, documented
    as not full asymmetric PKI), rollout dispatch reusing the same
    Control-dispatch/poll pattern as Compute/Deploy, `all-at-once` and
    `staged` (first-batch-then-`continueRollout`) strategies, rollback of
    successfully-applied nodes. Mounted at `/api/v1/updates`.
  - CLI: `orca update publish/rollout/status/continue/rollback` — all
    real. Verified manually against a live cluster (signed manifest →
    rollout → real simulated node applies it → completed) and via a real
    CLI e2e test spawning the actual binary through the full lifecycle.
  - Tests: 18 unit/integration (signing round-trip/tamper/wrong-key,
    all-at-once/staged/failure/rollback/group-targeting, router contract)
    + a real end-to-end test in `api.test.ts` (publish → rollout →
    complete through a real dispatched node).

- **Phase 17 — Orca Backup**
  - `@orca/backup`: `cluster-config` and `app-config` backups are real —
    they snapshot live data (Control's cluster config; a deployment's
    manifest) to a timestamped JSON file. `app-data` is architecture-only
    (job created, fails with a clear "no snapshot mechanism yet" reason)
    per the build instructions' own "configuration backups" vs. "data
    backup **architecture**" distinction.
  - Interval-based schedules (not full cron — explicit MVP scope, "backup
    **architecture**" not a cron engine), a background poller runs due
    ones. Restore is metadata-tracking (`recordRestore`, only accepted for
    a succeeded backup job) — not an automated restore executor.
  - Mounted at `/api/v1/backups`. CLI: `orca backup run/list/schedule/
    restore` — all real, verified manually end-to-end and via a real API
    integration test (live cluster-config change → backup → restore
    record).
  - Tests: 13 (real file writes for cluster-config/app-config, app-data
    architecture-only failure, restore-requires-succeeded-job, schedule
    CRUD + due-schedule execution via `pollSchedules`, router contract).

- **Phase 18 — Security improvements**
  - `docs/SECURITY.md` added: consolidated reference (fixes a dangling
    reference to this file that `control/src/config.ts` had pointed to
    since Phase 2).
  - **Audit events**: `@orca/security`'s new `AuditLog` + a global Express
    middleware (`api/src/middleware/audit.ts`) records every non-`GET`
    `/api/v1/*` request automatically — actor, action, status — rather
    than each route file needing to call it. `GET /api/v1/audit`
    (admin-only). Caught and fixed a real race during development: the
    audit write is fire-and-forget from a `res.on("finish")` handler, so a
    test's `close()` could return before the write was flushed; added
    `AuditLog.flush()` (same pattern as `JsonStore.flush()` used
    elsewhere) plus a one-tick yield in `close()`.
  - **Service-to-service auth** (Orca API ↔ Control): now opt-in via
    `ORCA_CONTROL_SERVICE_TOKEN` — unset (default) keeps Control's
    historical trusted-internal-network behavior; set it (and the same
    value on Orca API) to require a Bearer token on every Control route
    except `/health`. `ControlClient` sends it automatically when
    configured.
  - TLS on the mesh/HTTP servers remains deferred — documented in
    `docs/SECURITY.md` as needing certificate provisioning across nodes,
    more naturally an Orca OS/Hardware Daemon concern once physical nodes
    exist.
  - Tests: 4 in `security` (audit log CRUD/persistence/limit), 5 in
    `control` (`requireServiceToken` unit tests) + 1 integration test
    (full server with a configured token, `/health` still open), 1 in
    `api` (audit event recorded + admin-only access enforced).

- **Phase 19 — Orca AI**
  - `@orca/shared`: `ChatMessageSchema` (`role`/`content`) and
    `ConversationSchema` (`id`/`userId`/`title`/`model`/`messages`/
    `createdAt`/`updatedAt`) — the single source of truth for chat wire
    format, now shared by `@orca/ai-gateway` (which re-exports
    `ChatMessage` instead of redefining it) and the new conversation store.
  - `@orca/ai-gateway`: added `parseSseChunk`, a pure function that extracts
    OpenAI-style SSE `delta.content`/`message.content` text from a raw SSE
    byte chunk, tolerant of partial lines split across chunk boundaries
    (caller holds the `remainder` buffer across calls) and of `[DONE]`/
    malformed lines. Used to accumulate the full assistant reply for
    persistence while the raw bytes are still passed through to the client
    unmodified. Tests: 7.
  - `api/src/conversationStore.ts`: `ConversationStore`, a per-user
    `JsonStore`-backed CRUD store (`create`/`listForUser`/`get`/
    `appendMessage`/`rename`/`delete`), persisted under
    `<dataDir>/ai/conversations.json`.
  - `api/src/routes/conversations.ts`: `createConversationsRouter`, mounted
    at `/api/v1/ai/conversations` (auth required). List/create/get/rename/
    delete are ownership-checked against `req.user.userId` (404, not 403,
    for another user's conversation — doesn't leak existence).
    `POST /:id/messages` appends the user's message, then streams the
    assistant's reply as SSE straight from `AiGatewayService.streamChatCompletion`
    (byte-for-byte passthrough to the HTTP response) while using
    `parseSseChunk` to accumulate the full text server-side, and persists
    the completed assistant message once the stream ends.
  - Wired into `api/src/server.ts` and `api/src/openapi.ts`.
  - Tests: 4 in `api/src/conversations.test.ts` — full create→send→persist
    round trip against a fake OpenAI-SSE-shaped upstream server (same
    pattern as `aiGateway.test.ts`), list-scoped-to-user, 404 for another
    user's conversation, rename+delete.
  - `@orca/ai` (`orca-platform/ai/`): the chat frontend. React + Vite +
    TypeScript, same conventions as `@orca/dashboard` (no UI framework,
    shared design tokens, `getToken()`-gated routing). Dev server on
    `:5174`, proxies `/api` to Orca API (`vite.config.ts`).
    - Sidebar: lists the signed-in user's conversations
      (`GET /api/v1/ai/conversations`), "+ New chat", inline rename
      (double-click a title → input → Enter/blur to commit), delete.
    - Model picker: populated from `GET /api/v1/ai/models` (AI Gateway's
      OpenAI-compatible list, already filtered to models in
      `available`/`loaded` state); fixed once a conversation exists,
      selectable for a new chat.
    - Streaming: `sendMessage()` in `src/api.ts` does a raw `fetch` +
      `ReadableStream` read loop against
      `POST /api/v1/ai/conversations/:id/messages` (not `EventSource`,
      since that API doesn't support POST bodies/auth headers), parsing
      SSE deltas with a browser-side copy of `parseSseChunk`
      (`src/sseParser.ts` — duplicated rather than importing
      `@orca/ai-gateway`, whose entry point pulls in Express, a Node-only
      dependency chain with no place in a browser bundle). Deltas render
      live with a blinking-cursor indicator.
    - Markdown/code rendering: `src/components/Markdown.tsx`, a small
      dependency-free renderer (headings, bold/italic, inline code, fenced
      code blocks with a language label, links, un/ordered lists) that
      builds real React elements — never `dangerouslySetInnerHTML`, so
      there's no HTML-injection surface from a model's output.
    - File upload architecture: not yet implemented (no attachment UI or
      upload endpoint) — left for a follow-up once a concrete Storage
      target exists for it, per the "architecture" scoping used elsewhere
      in this build (e.g. Backup's app-data handling).
    - Tests: 17 unit/component (`api.test.ts` 6, `sseParser.test.ts` 5,
      `Markdown.test.tsx` 6) plus 1 real headless-browser end-to-end test
      (`tests/e2e/ai.test.ts`): logs in, waits for a real registered model
      to populate the picker, sends a message, and asserts the streamed
      reply renders through the real Markdown renderer (bold text becomes
      a real `<strong>`) against real Control + API processes and a fake
      Ollama/OpenAI-shaped upstream runtime — then renames and deletes the
      conversation through the real UI.
    - Wired into `scripts/dev-cluster.mjs` (starts alongside Control/API/3
      simulated nodes/Dashboard on `:5174`) and documented in the root
      `README.md`'s getting-started instructions.

- **Phase 20 — Orca Studio**
  - Backend lives directly in `@orca/api` (not a separate `@orca/*`
    package) — same reasoning as Orca AI's conversations: every resource
    is per-user application state, not cluster-wide state a CLI/Control
    consumer would need. `api/src/studioAgentConfigStore.ts`,
    `studioWorkflowStore.ts`, `studioRunStore.ts` (three `JsonStore`-backed
    per-user CRUD stores), `studioService.ts` (`StudioService`,
    orchestrates them + a narrow `StudioChatRuntime` port — `{complete(model,
    messages): Promise<string>}` — so this code never depends on
    `@orca/ai-gateway`'s full surface, same `ControlPort`-style structural
    interface pattern used by Compute/Deploy/Update), `routes/studio.ts`
    (`createStudioRouter`, mounted at `/api/v1/studio` behind auth only).
  - **Agent configs** (`StudioAgentConfig`): `name` + `systemPrompt` +
    `model` + `tools` (a declarative list of tool names — see Scope
    below). Full CRUD, ownership-checked per user (404 for another user's
    config, matching conversations' behavior).
  - **Workflows** (`StudioWorkflow`): `name` + an ordered, non-empty list
    of steps, each referencing an agent config by id. `runWorkflow` runs
    steps in order as a **linear pipeline** (explicit MVP scope, not a
    general DAG), chaining each step's output into the next step's input,
    and stops at the first failing step.
  - **Runs** (`StudioRun`): a durable history of every testing-console
    execution — `kind` (`agent`/`workflow`), `status`
    (`running`→`succeeded`/`failed`), per-step `StudioRunStepResult`
    (input/output/error/latency), and the final output.
  - **Scope**: `tools` on an agent config is metadata only — saved and
    displayed, never invoked. Real tool execution needs a function-calling
    -capable runtime integration (tool-call parsing, a tool registry, a
    sandboxed execution path) not built yet; tracked under Known
    limitations below rather than half-built.
  - `@orca/studio` (`orca-platform/studio/`): the frontend, React + Vite +
    TypeScript, same conventions as `@orca/dashboard`/`@orca/ai`. Sidebar
    with three tabs (Agents/Workflows/Runs); an agent config editor
    (name/system-prompt/model/tools) and a workflow editor (ordered,
    reorderable step list referencing saved agent configs); a shared
    testing-console component that runs the selected agent/workflow and
    renders the result (status, per-step results, output/error); a Runs
    tab that reuses the same result view for history.
  - Wired into `scripts/dev-cluster.mjs` (starts on `:5175`) and the root
    `README.md`.
  - Tests: 6 in `api/src/studioService.test.ts` (agent config CRUD +
    cross-user ownership isolation, single-agent run success/failure,
    workflow chaining, stop-on-first-failure — against a fake
    `StudioChatRuntime`) + 4 in `api/src/studio.test.ts` (full HTTP-level
    coverage: create+run through a real `AiGatewayService` and a fake
    Ollama/OpenAI-shaped upstream, cross-user 404s, two-step workflow run,
    400 on malformed input) + 9 frontend unit/component tests
    (`studio/src/api.test.ts` 5, `AgentConfigEditor.test.tsx` 2,
    `WorkflowEditor.test.tsx` 2) + 1 real headless-browser end-to-end test
    (`tests/e2e/studio.test.ts`): logs in, creates an agent config against
    a real registered model, runs it through the testing console against
    a fake upstream (real Control + API underneath), and confirms the run
    appears under the Runs tab.
  - Bug caught by the e2e test during development: `AgentConfigEditor`'s
    `model` field initialized from the `models` prop *once* at mount
    (`useState(config?.model ?? models[0]?.id ?? "")`), but `models` loads
    asynchronously — mounting "+ New agent" before the fetch resolved left
    `model` permanently `""` and Save permanently disabled, since a
    `useState` initializer only runs on first render. Fixed with a
    `useEffect` that defaults to the first available model once `models`
    arrives, but only for a new/unsaved config with no selection yet
    (never overrides a saved config's model or a choice the user already
    made) — same class of "prop arrives after mount, stale initial state"
    bug as the `SimulatedMetricsProvider` bug from Phase 3/4, caught the
    same way: a real end-to-end test driving the actual UI, not a unit
    test with synchronous fixture data.

- **Phase 21 — App Backend**
  - `@orca/app-backend`: a real standalone package (not folded into
    `@orca/api` like Orca AI/Studio's backends) — reserved as its own
    workspace from Phase 1's scaffolding, and unlike those two it has no
    frontend counterpart in this repo to make sharing implementation with
    `api/` the more natural home; it's a genuine subsystem `@orca/api`
    mounts, same shape as `@orca/compute`/`@orca/deploy`/`@orca/update`.
  - Explicitly **not** a duplicate of what already exists: auth, AI
    conversations, and nodes/apps/models/jobs are already real REST
    resources at `/api/v1/*` that a mobile/desktop client uses directly.
    This package covers only the genuinely mobile-specific pieces:
    - **Server discovery** (`GET /api/v1/app/discover`, the one
      unauthenticated route under `/api/v1/app`): identity check
      (service/clusterName/apiVersion/serverTime) so a client can verify
      it found a real Orca server before it has a session token. Real
      network-level discovery (mDNS/Bonjour, so a client doesn't need a
      manually-entered address) needs OS-level support and isn't built —
      documented as an OS integration requirement, not implemented here.
    - **Cluster summary** (`GET /api/v1/app/summary`, authenticated): one
      compact request (node counts, average CPU/RAM across nodes that
      have reported metrics) instead of a mobile client fetching and
      aggregating `/nodes` itself.
    - **Notifications** (`/api/v1/app/notifications`): a per-user inbox.
      Admin/operator can send to one user or broadcast to every known
      user (`POST`, gated by `writeGuard`); any user lists/marks their
      own read. Real production use: system-wide announcements
      ("cluster restarting at 10pm") — not a synthetic feature.
    - **Device registry** (`/api/v1/app/devices`): register a push token
      (platform + opaque token) per user. This is the registry a real
      push relay (APNs/FCM) would read from to actually deliver
      notifications — **that delivery step is not implemented**;
      registering a device today only makes it visible via the API. No
      subsystem currently auto-generates notifications from job/deploy/
      backup/update completions either, since none of those track a
      submitting user yet (they're cluster-wide admin/operator actions,
      not user-attributed) — wiring that up would mean changing already-
      shipped schemas across multiple tested packages, a larger and
      riskier change than this phase's honest scope.
  - `AppBackendService` takes two narrow structural ports — `ClusterPort`
    (`getClusterConfig`/`listNodes`, satisfied directly by
    `api/src/controlClient.ts`'s existing `ControlClient` — no adapter
    needed) and `UserDirectory` (`listUserIds`, a one-line adapter over
    `@orca/security`'s `UserStore`) — the same `ControlPort`-style pattern
    used by Compute/Deploy/Update, so this package never depends on
    those packages' full surface.
  - `createAppBackendRouter` takes `requireAuth`/`writeGuard` and applies
    them **per-route** (not at the `app.use()` mount level, unlike every
    other router) specifically so `/discover` can stay public while
    every other `/api/v1/app` route requires a session — the router is
    still mounted as a single unit in `api/src/server.ts`.
  - Tests: 7 in `app-backend/src/appBackendService.test.ts` (discovery,
    summary aggregation including "no metrics yet" and "some nodes
    missing metrics", per-user notification CRUD + broadcast, device
    ownership) + 5 in `app-backend/src/routes.test.ts` (router contract
    with fake auth middleware) + 4 in `api/src/appBackend.test.ts` (full
    HTTP-level coverage against a real Control + API: unauthenticated
    discover reflecting the real cluster name, 401/200 on summary, a
    real second user receiving and reading a broadcast, a viewer
    correctly forbidden from sending one, device register/list/delete).

## Partially completed / next up

- Phases 22-24: not started (see `orca-platform/README.md` for the full
  component list and the top-level build instructions for phase ordering).

## Tests

Run `npm test` from `orca-platform/` (or `npx vitest run --root <package>`
per package). Run `npx tsc -b tsconfig.json` from `orca-platform/` to
typecheck every package that's been added to the root `tsconfig.json`
references list — **remember to add new packages to that references array
as they're created**, or they silently won't be typechecked as part of the
whole-platform build.

All tests currently green: `shared` (7), `mesh` (4), `security` (10),
`control` (12), `agent` (12), `compute` (11), `scheduler` (10), `models`
(21), `ai-gateway` (16), `deploy` (11), `storage` (11),
`hardware-daemon` (16), `update` (18), `backup` (13), `api` (34),
`cli` (7), `app-backend` (12), `dashboard` (9), `ai` (17), `studio` (9),
`tests` e2e (9) = 269/269.

Note: `dashboard/`, `ai/`, and `studio/` are intentionally **not** in the
root `tsconfig.json` `tsc -b` graph — they're Vite/browser apps with
`moduleResolution: "Bundler"` and their own `tsc --noEmit` typecheck
(`npm run typecheck` in each), separate from the NodeNext backend project
references.
`tests/` pulls in `playwright-core` (driving the pre-installed Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) for the Dashboard,
Orca AI, and Orca Studio browser tests — not used elsewhere.

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
- Orca Studio's `tools` field on an agent config is declarative metadata
  only — saved and shown, never invoked. Real tool execution needs a
  function-calling-capable runtime integration (tool-call parsing from a
  model's response, a tool registry, a sandboxed execution path) that
  isn't built yet.
- Orca Studio's workflow engine is a linear pipeline (each step's output
  feeds the next step's input) — not a general DAG with branching/fan-out.
  A real workflow-graph engine is future scope if a use case needs it.
- App Backend's device registry has no matching push-delivery
  implementation — registering a device's push token doesn't cause
  anything to actually be sent to it; a real push relay (APNs/FCM) would
  need to be built and wired to read from `DeviceStore`.
- No subsystem auto-generates App Backend notifications from job/deploy/
  update/backup completions — those records don't track a submitting
  user yet (cluster-wide admin/operator actions, not user-attributed),
  so wiring that up would mean changing already-shipped schemas across
  several tested packages. `POST /api/v1/app/notifications` (admin/
  operator, to one user or broadcast) is real and works today; automatic
  producers are future work.
- App Backend's `/discover` only verifies a server a client already has
  an address for — it doesn't do network-level discovery (mDNS/Bonjour)
  so a client could find a server with no address at all. That needs
  OS-level support; see `docs/OS_INTEGRATION.md`.

## Architecture decisions

- One monorepo, one `@orca/shared` schema package as the single source of
  truth for every cross-service message shape — avoids drift between
  Agent/Control/API/CLI/Dashboard.
- Mesh protocol is a small explicit discriminated union (not a generic
  RPC framework) — easy to reason about, easy to extend.
- Every service's config is env-var driven with no hard-coded secrets;
  `ORCA_CLUSTER_TOKEN` is required (the process throws on startup if unset)
  rather than defaulting to a guessable value.
- Browser apps (`dashboard/`, `ai/`) never import a Node-oriented backend
  package for a shared utility, even a pure one — `ai/src/sseParser.ts` is
  a deliberate small duplication of `ai-gateway/src/sseParser.ts` rather
  than a dependency on `@orca/ai-gateway` (whose entry point re-exports an
  Express router), so the frontend bundle never has a reason to try to
  resolve Node-only modules. Type-only imports from `@orca/shared` remain
  fine (erased at build, e.g. `ChatMessage`/`Conversation`) since no
  runtime code is pulled in.

## OS integration requirements

See `orca-platform/docs/OS_INTEGRATION.md`.

## Next work

1. Full integration tests (Phase 22): cross-subsystem scenarios beyond
   what each package's own e2e test already covers.
2. Documentation pass (Phase 23): review every README/doc for accuracy
   against the final Phase 1-21 state.
3. Platform-wide testing, fixes, and cleanup (Phase 24).
