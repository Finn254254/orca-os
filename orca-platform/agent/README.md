# @orca/agent

Orca Agent: the per-node daemon. Connects to Orca Control, registers this
machine's identity, sends periodic heartbeats with host metrics, and
executes commands Control dispatches to it.

## Running

Real host mode:

```bash
ORCA_CONTROL_URL=ws://localhost:7000/mesh \
ORCA_CLUSTER_TOKEN=dev-token \
ORCA_NODE_NAME=$(hostname) \
npm run dev
```

Simulated node mode (for the multi-node dev cluster — no real hardware
metrics, synthetic but plausible ones instead):

```bash
ORCA_CONTROL_URL=ws://localhost:7000/mesh \
ORCA_CLUSTER_TOKEN=dev-token \
ORCA_NODE_NAME=sim-node-01 \
ORCA_SIMULATED=1 \
ORCA_DATA_DIR=./data/sim-node-01 \
npm run dev
```

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ORCA_CONTROL_URL` | yes | — | Mesh WebSocket URL, e.g. `ws://host:7000/mesh` |
| `ORCA_CLUSTER_TOKEN` | yes | — | Must match Control's token |
| `ORCA_NODE_NAME` | no | hostname | Display name |
| `ORCA_NODE_GROUP` | no | `default` | Node group |
| `ORCA_DATA_DIR` | no | `./data` | Where node identity is persisted |
| `ORCA_SIMULATED` | no | `false` | Use synthetic metrics instead of real host metrics |
| `ORCA_SIM_CPU_CORES`, `ORCA_SIM_RAM_BYTES`, `ORCA_SIM_GPU` | no | — | Tune the simulated profile |
| `ORCA_HEARTBEAT_INTERVAL_MS` | no | `5000` | Overridden by Control's cluster config once connected |
| `ORCA_ALLOW_SHELL_COMMANDS` | no | `false` | Enable the `shell` command (disabled by default) |
| `ORCA_ALLOW_POWER_COMMANDS` | no | `false` | Enable real `power` (reboot/shutdown) commands (disabled by default; simulated nodes never actually power off) |
| `ORCA_WATCHED_SERVICES` | no | `orcad` | Comma-separated service names to report status for (real mode) |

## Commands

`ping`, `start_service`/`stop_service`/`restart_service` (via `systemctl`),
`shell` (opt-in, arbitrary command execution — this is what makes the agent
a remote administration surface, so it is off unless explicitly enabled),
`power` (opt-in for real nodes; simulated nodes always simulate it so the
dev cluster never actually reboots the host machine).

## Metrics

- `metrics/real.ts` — `systeminformation`-backed real host metrics.
- `metrics/simulated.ts` — synthetic but schema-valid, jittered metrics for
  the development/demo cluster.

Both implement the same `MetricsProvider` interface, so `agent.ts` doesn't
care which one it's given.

Run tests: `npx vitest run --root agent` (from `orca-platform/`).
