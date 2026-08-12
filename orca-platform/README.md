# Orca Platform

The software platform that runs **above** Orca OS: the control plane, agent,
mesh networking, API, CLI, dashboard, compute/scheduler, model management,
AI gateway, app deployment, storage, hardware daemon, update/backup
management, security, and the first-party AI apps (Orca AI, Orca Studio).

Orca OS itself (the Linux-based OS, `orcad`, and the OS-level `orca` CLI at
the repository root) is owned and developed separately. This directory does
not modify anything outside itself. See `docs/OS_INTEGRATION.md` for the
interfaces this platform needs from Orca OS.

## Layout

```
orca-platform/
├── shared/          canonical types/schemas, logging, persistence, auth helpers
├── mesh/            Agent <-> Control communication protocol (WebSocket)
├── control/         Orca Control: cluster state, node registry, health, commands
├── agent/           Orca Agent: per-node daemon (metrics, heartbeats, commands)
├── api/             Orca API: versioned REST + realtime WebSocket
├── cli/             `orca` command-line client (talks to Orca API)
├── dashboard/       Orca Dashboard: web admin UI (React)
├── compute/         Compute job system
├── scheduler/       Job scheduler / node selection
├── models/          Model Manager (registry + runtime adapters)
├── ai-gateway/       Unified inference API (OpenAI-compatible)
├── deploy/          Application deployment manifests + engine
├── storage/         Storage device/pool management
├── hardware-daemon/ Simulated (later real) board-management hardware
├── update/          Cluster-wide update management
├── backup/          Backup management
├── security/        Users, auth, sessions, secrets, audit
├── ai/              Orca AI: user-facing chat app
├── studio/          Orca Studio: agent/workflow builder app
├── app-backend/     Backend endpoints for future mobile/desktop apps
├── tests/           Cross-service integration tests
├── docs/            Architecture, progress, OS integration notes
└── scripts/         Dev tooling (multi-node simulation launcher, etc.)
```

## Tech stack

- **Language**: TypeScript (Node.js 20+), run directly via `tsx` in
  development (no build step required to iterate).
- **Monorepo**: npm workspaces. `npm install` at this directory's root
  installs everything.
- **HTTP**: Express 5. **Realtime**: `ws` WebSockets.
- **Validation**: `zod` schemas in `@orca/shared` are the single source of
  truth for every wire format between services.
- **Persistence**: dependency-light atomic JSON file store (`@orca/shared`'s
  `JsonStore`) for MVP durability. Interfaces are kept narrow so a real
  database can replace it later without touching callers.
- **Testing**: `vitest`, plus `supertest` for HTTP integration tests.

## Getting started

```bash
cd orca-platform
npm install
npm test                 # run every workspace's test suite
npx tsc -b tsconfig.json # typecheck the whole platform (backend packages)
npm run dev:cluster      # start Control + 3 simulated nodes + API + Dashboard + Orca AI + Orca Studio
```

Then open http://localhost:5173 (Dashboard), http://localhost:5174 (Orca
AI), or http://localhost:5175 (Orca Studio) and log in with `admin` /
`admin-password` (override via `ORCA_ADMIN_USERNAME`/
`ORCA_ADMIN_PASSWORD`). Press Ctrl+C to stop everything —
`scripts/dev-cluster.mjs` owns the child processes and shuts them all
down together.

Alternatively, with Docker:

```bash
docker compose up --build
```

does the same thing in containers (see `docker-compose.yml` — validated
with `docker compose config`; `npm run dev:cluster` is the path actually
exercised by the test suite, see `tests/e2e/dev-cluster.test.ts`).

See `docs/PROGRESS.md` for current status and `docs/ARCHITECTURE.md` for the
system design.
