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
Compute + Scheduler + Storage + Models + Deploy   (in progress)
  ↓
Orca API + AI Gateway               (public-facing gateway)
  ↓
CLI + Dashboard + Orca AI + Studio + future apps
```

## Process topology (as built through Phase 8)

Four Node.js processes plus a browser SPA:

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
- **Orca API** (`api/`, default port 8080): the only service end users/apps
  talk to directly. User auth (`@orca/security`), proxies Control for
  nodes/cluster/commands, realtime `/ws`. This is where Compute/Scheduler/
  Model Manager/etc. will mount their own route files as they're built.
- **Orca Dashboard** (`dashboard/`): React SPA served by Vite, talks only
  to Orca API (REST + `/ws`), never to Control/Agents directly.
- **Orca CLI** (`cli/`): same rule — talks only to Orca API.

## Why a monorepo, why these boundaries

- `@orca/shared`'s zod schemas are the single source of truth for every
  wire format crossing a process boundary (Agent↔Control, API↔Dashboard/
  CLI). Types are inferred from the schemas, so validation and typing can't
  drift apart, and every service imports the same definitions.
- Control and API are deliberately separate processes with different trust
  boundaries: Control is the internal cluster brain (mesh auth via a shared
  cluster token), API is the authenticated gateway everything else talks
  to. This mirrors the target architecture (API + AI Gateway sitting above
  Control) and means Control's internal API surface can stay simple.
- Compute/Scheduler/Model Manager/AI Gateway/Deploy/Storage (Phases 9-14)
  are planned as **libraries mounted into the Orca API process**, not as
  separate network services — deliberately, per the build instructions'
  "reliable MVP over complicated infra" guidance. If/when one needs to
  scale independently, it can be split out later; the route-file structure
  already isolates each subsystem's HTTP surface.
- Persistence is a single atomic JSON file per service (`@orca/shared`'s
  `JsonStore`) rather than a database. Sufficient for the node/command/job
  counts this phase targets; revisit if/when the platform needs to survive
  concurrent writers across multiple processes.

## Mesh protocol

A small explicit discriminated union (`hello` / `heartbeat` / `command` /
`command_result` / `ack` / `error`) over WebSocket, not a generic RPC
framework — see `mesh/README.md`. Auth today is a shared cluster token
presented in `hello`; TLS (`wss://`) and per-node credentials are deferred
to the Security phase (Phase 18).

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
