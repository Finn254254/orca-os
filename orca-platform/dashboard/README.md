# @orca/dashboard

Orca Dashboard: the web admin UI. React + Vite + TypeScript, no UI
framework dependency — plain CSS using the platform's data-viz palette
(status colors, sequential blue meters), light/dark aware.

## Running

```bash
ORCA_API_PROXY_TARGET=http://localhost:8080 npm run dev
```

The dev server proxies `/api` and `/ws` to Orca API (see `vite.config.ts`),
so the browser talks to same-origin paths and there's no CORS setup needed
in development. For a production build served separately from the API, set
`VITE_ORCA_API_URL` at build time to the API's origin.

## Pages

- **Overview** — cluster health stat tiles (node counts, average CPU, RAM
  used %) and the live node table.
- **Nodes** / **Node detail** — real node list and per-node capabilities,
  live metrics (CPU/RAM/disk meters, temperatures), services, and a "Send
  ping" command button that round-trips through Orca API -> Control ->
  Agent.
- **Settings** — cluster config (read-only view) and user management
  (admin only): list/create/delete users.
- **Jobs** (`/compute` and `/jobs`) — real, live-refreshing compute job
  list via `@orca/compute` (state, assigned node, scheduling/failure
  reason). Read-only: submit a job via `orca run` (CLI) or
  `POST /api/v1/jobs`.
- **Models** — real Model Manager registry via `@orca/models` (runtime,
  state, download progress). Read-only: pull a model via
  `orca model-pull` (CLI) or `POST /api/v1/models/pull`.
- **Storage** — real device/pool/capacity data via `@orca/storage`.
  Read-only.
- **Applications** — real app deployments via `@orca/deploy`, including a
  working **Remove** button (`DELETE /api/v1/apps/:id`). Deploying a new
  app is CLI/API-only for now: `orca deploy <manifest.json>` or
  `POST /api/v1/apps`.
- **Logs** — the one remaining "coming soon" placeholder. Not backed by
  mock data; says plainly the subsystem doesn't exist yet. No dedicated
  log-aggregation service was built this project (out of the original
  phase plan's scope as things stood) — revisit if a use case needs
  centralized logs beyond what audit events and per-job logs
  already provide.

Everything above "coming soon" is wired to real Orca API data — nothing is
a static mock. Verified in an actual headless-browser end-to-end test
(`orca-platform/tests/e2e/dashboard.test.ts`): logs in, waits for a real
simulated Agent process to appear in the table with its real status and
live CPU%, and confirms real capabilities render on the node detail page.

## Realtime

Subscribes to Orca API's `/ws` and folds `node`/`metrics` events into the
node list and node detail views live — no polling from the browser.

Run tests: `npx vitest run --root dashboard` (component/unit, jsdom) and
`npx vitest run --root tests` (includes the Playwright browser e2e test).
