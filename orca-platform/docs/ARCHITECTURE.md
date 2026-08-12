# Orca Platform Architecture

## Layering

```
Physical Hardware
  ↓
Orca OS (owned separately — see OS_INTEGRATION.md)
  ↓
Orca Agent + Hardware Daemon        (per-node)
  ↓
Orca Mesh                           (Agent <-> Control transport)
  ↓
Orca Control                        (cluster state authority)
  ↓
Compute + Scheduler + Storage + Models + Deploy + Update + Backup
  ↓
Orca API + AI Gateway + App Backend (public-facing gateway)
  ↓
CLI + Dashboard + Orca AI + Orca Studio
```

## Process topology (as built through Phase 22)

Six Node.js processes plus three browser SPAs, all reachable through one
gateway:

- **Orca Control** (`control/`, default port 7000): owns cluster state —
  node registry, groups, health, commands, persistent config. Accepts
  authenticated WebSocket connections from Agents at `/mesh` and exposes an
  internal REST API at `/api/v1` (trusted network; no user auth — Orca API
  is the authenticated public boundary in front of it).
- **Orca Agent** (`agent/`, one process per node): connects to Control via
  `@orca/mesh`'s `MeshClient`, registers, sends heartbeats with host
  metrics, executes commands. Runs identically against real hardware
  (`systeminformation`) or in simulated mode (synthetic metrics) — same
  code path either way.
- **Orca Hardware Daemon** (`hardware-daemon/`, one process per node,
  optional): board-management functions (fans, watchdog, temperatures)
  behind a `HardwareBackend` interface — a `SimulatedHardwareBackend` today,
  a real one once physical Orca hardware exists. Its own small HTTP API;
  deliberately not wired into API/CLI/Dashboard yet (see `docs/PROGRESS.md`).
- **Orca API** (`api/`, default port 8080): the only service end
  users/apps/CLI/Dashboard/Orca AI/Orca Studio talk to directly. User auth
  (`@orca/security`), proxies Control for nodes/cluster/commands, realtime
  `/ws`, and mounts every other subsystem's router: Compute (`/jobs`),
  Model Manager (`/models`), AI Gateway (`/ai`), Deploy (`/apps`), Storage
  (`/storage`), Update (`/updates`), Backup (`/backups`), Studio
  (`/studio`), App Backend (`/app`), and Orca AI's own conversation store
  (`/ai/conversations`).
- **Orca Dashboard** (`dashboard/`, dev port 5173): React SPA served by
  Vite — cluster admin UI. Talks only to Orca API (REST + `/ws`).
- **Orca AI** (`ai/`, dev port 5174): React SPA — the user-facing chat app.
  Talks only to Orca API.
- **Orca Studio** (`studio/`, dev port 5175): React SPA — the
  agent/workflow builder. Talks only to Orca API.
- **Orca CLI** (`cli/`): same rule — talks only to Orca API.

`scripts/dev-cluster.mjs` (`npm run dev:cluster`) starts Control, three
simulated Agents, API, Dashboard, Orca AI, and Orca Studio with one
command for local development/demo purposes.

## Why a monorepo, why these boundaries

- `@orca/shared`'s zod schemas are the single source of truth for every
  wire format crossing a process boundary (Agent↔Control, API↔Dashboard/
  CLI/Orca AI/Orca Studio). Types are inferred from the schemas, so
  validation and typing can't drift apart, and every service imports the
  same definitions.
- Control and API are deliberately separate processes with different trust
  boundaries: Control is the internal cluster brain (mesh auth via a shared
  cluster token, optionally a service token in front of its REST API too —
  see `docs/SECURITY.md`), API is the authenticated gateway everything else
  talks to.
- Compute/Scheduler/Model Manager/AI Gateway/Deploy/Storage/Update/Backup/
  App Backend are **libraries mounted into the Orca API process**, not
  separate network services — deliberately, per the build instructions'
  "reliable MVP over complicated infra" guidance. Each is its own npm
  workspace package with its own tests, but at runtime they're all one
  process. If/when one needs to scale independently, it can be split out
  later; the route-file structure already isolates each subsystem's HTTP
  surface. Orca AI's conversation store and Orca Studio's agent-config/
  workflow/run stores follow the same principle taken one step further —
  since every resource they expose is per-user application state with no
  other consumer (not cluster-wide state a CLI/Control-level consumer
  would need), their backend code lives directly in `api/src/` rather than
  as separate packages at all; see `api/README.md`.
- Persistence is a single atomic JSON file per service (`@orca/shared`'s
  `JsonStore`) rather than a database. Sufficient for the node/command/job
  counts this phase targets; revisit if/when the platform needs to survive
  concurrent writers across multiple processes.

## Mesh protocol

A small explicit discriminated union (`hello` / `heartbeat` / `command` /
`command_result` / `ack` / `error`) over WebSocket, not a generic RPC
framework — see `mesh/README.md`. Auth today is a shared cluster token
presented in `hello`, plus an optional service token in front of
Control's REST API (`docs/SECURITY.md`, added in Phase 18). TLS (`wss://`)
and per-node credentials remain a known limitation — see
`docs/PROGRESS.md`.

## Realtime

Orca API's `/ws` is sourced by polling Control on a short interval and
diffing against the last-seen snapshot (see `api/src/realtime.ts`) — not a
push-based event bus across the process boundary. Simple, reliable, and
sufficient at dev-cluster scale; revisit if cluster size or update latency
requirements grow.

## Where to look next

- `docs/PROGRESS.md` — current status, what's tested, known limitations.
- `docs/OS_INTEGRATION.md` — what Orca Platform needs from Orca OS.
- Each package's own `README.md` — specifics for that component.
