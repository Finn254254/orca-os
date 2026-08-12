# @orca/storage

Centralized storage visibility. Mounted into Orca API at
`/api/v1/storage`.

## Device discovery — no new agent work needed

Orca Agent already reports each node's disks (mount, device, filesystem,
total/used bytes) in its heartbeat metrics. `StorageService.listDevices()`
just aggregates what's already flowing through Control — no new per-node
polling. `GET /capacity` sums that into a cluster-wide total.

Device health is a simple usage-threshold heuristic (`>=90%` warning,
`>=97%` critical) since SMART/hardware health isn't part of the metrics
model yet — a real signal to wire up once Hardware Daemon (Phase 15)
exists.

## Pools and locations

`StorageStore` owns two small registries: storage **pools** (named
groupings of nodes) and **locations** (`model`/`dataset`/`app-data`/
`backup` → a specific node + path) — `GET/POST /pools`,
`GET/POST /locations` (filterable by `?kind=`), `DELETE` for both.

## Scope

Distributed storage (pooling raw capacity across nodes into one
filesystem) is explicitly out of scope for this phase, per the build
instructions — this tracks/labels where things live today, and gives a
foundation to build a real distributed layer on later without redesigning
the API surface.

Run tests: `npx vitest run --root storage` (from `orca-platform/`).
