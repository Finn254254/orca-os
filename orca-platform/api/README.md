# @orca/api

Orca API: the main gateway for the Orca ecosystem — the only service end
users/apps/CLI/Dashboard talk to directly. User-authenticated, versioned
REST under `/api/v1`, plus a realtime WebSocket at `/ws`.

## Running

```bash
ORCA_SESSION_SECRET=dev-session-secret \
ORCA_CONTROL_URL=http://localhost:7000 \
ORCA_ADMIN_USERNAME=admin \
ORCA_ADMIN_PASSWORD=change-me \
npm run dev
```

`ORCA_ADMIN_USERNAME`/`ORCA_ADMIN_PASSWORD` only take effect once, to create
the first admin user if none exist yet — never hard-coded, always from env.
Set `ORCA_CONTROL_SERVICE_TOKEN` to match Control's if Control requires
service auth (see `docs/SECURITY.md`).

## Endpoints (`/api/v1`)

Auth/users: `POST /auth/login`, `GET /auth/me`, `GET/POST /users`,
`DELETE /users/:id` (admin only).

Cluster (proxies Orca Control): `GET/PUT /cluster/config`,
`GET/POST /cluster/groups`, `GET /nodes[...]`, `GET/POST /commands[...]`.

Subsystems mounted as libraries (see each package's own README for detail):
`/jobs` (`@orca/compute`), `/models` (`@orca/models`), `/ai` (`@orca/ai-gateway`,
OpenAI-compatible), `/apps` (`@orca/deploy`), `/storage` (`@orca/storage`),
`/updates` (`@orca/update`), `/backups` (`@orca/backup`), `/app`
(`@orca/app-backend` — mobile/desktop client support: server discovery,
cluster summary, notifications, device registry; `/app/discover` is the
one route in this API that's intentionally unauthenticated).

Orca AI and Orca Studio's backends live directly in this package rather
than as separate `@orca/*` libraries, since every resource they expose is
per-user application state (conversations, agent configs, workflows, run
history) rather than cluster-wide state a CLI/Control-level consumer would
need: `/ai/conversations` (`conversationStore.ts`, `routes/conversations.ts`)
and `/studio/*` (`studioAgentConfigStore.ts`, `studioWorkflowStore.ts`,
`studioRunStore.ts`, `studioService.ts`, `routes/studio.ts`). Both are
mounted behind `requireAuth` only (no admin/operator `writeGuard`), since
ownership is checked per-resource against the caller's own `userId`.

`GET /audit` (admin only) — every mutating request, recorded automatically.
`GET /openapi.json` — hand-maintained API description, extended alongside
each new route.

Every route except `/auth/login`, `/health`, and `/openapi.json` requires
`Authorization: Bearer <session-token>` from `/auth/login`. Mutating routes
generally require `admin`/`operator`; reads are open to any authenticated
role. See `docs/SECURITY.md` for the full auth/audit picture.

## Realtime (`/ws`)

Broadcasts `RealtimeEvent`s (see `@orca/shared`) on the `node` and `metrics`
channels, sourced by polling Control (`ORCA_API_POLL_INTERVAL_MS`, default
1000ms) and diffing against the last-seen snapshot.

Run tests: `npx vitest run --root api` (from `orca-platform/`).
