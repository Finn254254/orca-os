# @orca/deploy

Orca Deploy: application deployment from a manifest. Mounted into Orca API
at `/api/v1/apps`.

## Manifest

`name`, `version`, `image`, `ports`, `volumes`, `env`, `resources`,
`targetCapabilities`, `targetNodeId`/`targetGroup`, `restartPolicy`
(`always`/`on-failure`/`never`). See `AppManifestSchema` in `@orca/shared`.

## Flow

Same pattern as `@orca/compute`: `deployApp(manifest)` → `@orca/scheduler`
picks a node (reusing the exact same scoring engine Compute uses, via the
shared `SchedulableSpec` interface) → a `deploy_app` command is dispatched
to the node → the agent runs `docker run -d --name ... --restart ...`
(real nodes) or simulates it without touching the host (simulated nodes) →
a background poller updates the deployment to `running` with its container
id once the command resolves. `orca remove` / `DELETE /apps/:id` dispatches
`remove_app` (`docker rm -f`) and marks the deployment `stopped`.

Run tests: `npx vitest run --root deploy` (from `orca-platform/`).
