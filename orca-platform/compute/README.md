# @orca/compute

Orca's compute job system. Mounted into Orca API at `/api/v1/jobs` (see
`orca-platform/docs/ARCHITECTURE.md` for why Compute is a library inside
the API process rather than its own service).

## Flow

`submitJob(spec)` → `@orca/scheduler` picks a node (or the job fails
immediately with a clear reason if none qualify) → a `run_job` command is
dispatched to the node via Orca Control → the agent executes it (real
`execFile` on real nodes; a safe simulated result on simulated nodes, see
`agent/src/commands.ts`) → a background poller (`startJobPoller`, ~1s
interval) watches the dispatched command and updates the job to
`succeeded`/`failed` with its result/logs once the command resolves.

Jobs run on a single node today (Phase 9 scope). `JobSpec` already carries
`targetGroup`/`requiredCapabilities` so multi-node workloads can be added
later without a schema change.

## Known limitation

Cancelling a `running` job marks it `cancelled` locally but there is no
in-flight cancellation command yet — the node may still finish executing;
the job just stops accepting that result once cancelled.

Run tests: `npx vitest run --root compute` (from `orca-platform/`).
