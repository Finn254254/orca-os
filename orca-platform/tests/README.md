# @orca/tests

Cross-service integration tests that exercise real, independently-running
Orca Platform processes (as opposed to each package's own unit/in-process
tests).

- `e2e/support.ts` — spawns a service via `tsx` from the monorepo root and
  provides a polling `waitUntil` helper for async convergence.
- `e2e/control-agent.test.ts` — spawns real `orca-control` and `orca-agent`
  processes and drives them over HTTP/WebSocket: registration, live
  metrics, command round-trip, offline detection on process death.

Run: `npx vitest run --root tests` (from `orca-platform/`).
