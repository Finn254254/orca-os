# @orca/update

Cluster-wide update management. Mounted into Orca API at
`/api/v1/updates`. Does **not** perform OS installation itself — see
`orca-platform/docs/OS_INTEGRATION.md`.

## Flow

1. `publishManifest` — stores a manifest (`version`, `artifactUrl`,
   `checksum`) HMAC-signed with `ORCA_UPDATE_SIGNING_KEY` if configured
   (`signing.ts` — MVP tamper-evidence, not a full asymmetric PKI; see its
   doc comment for why and what upgrading it would take).
2. `startRollout` — resolves target nodes (all / a group / explicit ids),
   dispatches `apply_update` commands via Control (same dispatch/poll
   pattern as Compute/Deploy). `all-at-once` sends to every target
   immediately; `staged` sends to a percentage-sized first batch and waits
   for `continueRollout` to proceed to the rest.
3. A background poller advances rollout/per-node state as commands
   resolve; a rollout completes once every targeted node succeeds, or
   fails if any node fails.
4. `rollback` dispatches `rollback_update` to every node that had
   successfully applied the update.

## Agent side

`agent/src/commands.ts` handles `apply_update`/`rollback_update` by
shelling out to a pluggable `orca-os-updater` binary
(`ORCA_OS_UPDATER_BIN`, default `orca-os-updater`). If that binary isn't
found (`ENOENT`) — true today, since no such binary exists yet — it
**succeeds with a logging-only result** rather than failing, so the
rollout pipeline can be built and tested before Orca OS ships a real
updater. Simulated nodes always simulate, matching the `run_job`/
`deploy_app` pattern.

Run tests: `npx vitest run --root update` (from `orca-platform/`).
