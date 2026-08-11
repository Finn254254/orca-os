# @orca/api

Orca API: the main gateway for the Orca ecosystem. User-authenticated,
versioned REST under `/api/v1`, plus a realtime WebSocket at `/ws`. Proxies
Orca Control (nodes/cluster/commands) and owns users/authentication itself.

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

## Endpoints (`/api/v1`)

- `POST /auth/login`, `GET /auth/me`
- `GET/POST /users`, `DELETE /users/:id` (admin only)
- `GET /nodes`, `GET /nodes/:id`, `GET /nodes/:id/metrics`
- `GET/POST /nodes/:id/commands` (POST requires admin/operator)
- `GET /commands`, `GET /commands/:id`
- `GET/PUT /cluster/config` (PUT requires admin)
- `GET/POST /cluster/groups` (POST requires admin/operator)
- `GET /openapi.json` — machine-readable API description (hand-maintained,
  extended alongside each new route)

Every route except `/auth/login`, `/health`, and `/openapi.json` requires
`Authorization: Bearer <session-token>` from `/auth/login`.

## Realtime (`/ws`)

Broadcasts `RealtimeEvent`s (see `@orca/shared`) on the `node` and `metrics`
channels today, sourced by polling Control (`ORCA_API_POLL_INTERVAL_MS`,
default 1000ms) and diffing against the last-seen snapshot. `job`, `log`,
and `alert` channels will start broadcasting once Compute/Backup/etc. exist
to produce that data — the event envelope already supports them.

## Auth model

Session tokens are stateless HMAC-signed tokens (no server-side session
store), so **logout is client-side only for now** — there's no revocation
list yet. Documented as a known limitation; see `docs/PROGRESS.md`.

Run tests: `npx vitest run --root api` (from `orca-platform/`).
