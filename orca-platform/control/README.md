# @orca/control

Orca Control: the authoritative source of cluster state.

## Responsibilities

Node registration/identity/discovery, groups, online/offline status,
heartbeats, hardware capabilities, service status, node health (heartbeat
timeout sweeper + immediate disconnect detection), commands, and persistent
cluster configuration.

## Running

```bash
ORCA_CLUSTER_TOKEN=dev-token npm run dev
```

Environment variables:

- `ORCA_CLUSTER_TOKEN` (required) — shared secret Agents must present in
  their `hello` message.
- `ORCA_CONTROL_PORT` (default `7000`)
- `ORCA_DATA_DIR` (default `./data`) — where `cluster-state.json` is
  persisted.
- `ORCA_CLUSTER_NAME` (default `orca-cluster`)

## HTTP API (`/api/v1`)

- `GET /health`
- `GET/PUT /cluster/config`
- `GET/POST /cluster/groups`
- `GET /nodes`, `GET /nodes/:id`, `GET /nodes/:id/metrics`
- `GET/POST /nodes/:id/commands`, `GET /commands`, `GET /commands/:id`

## Mesh endpoint

Agents connect over WebSocket at `ws://<host>:<port>/mesh` (see
`@orca/mesh`).

Run tests: `npx vitest run --root control` (from `orca-platform/`).
