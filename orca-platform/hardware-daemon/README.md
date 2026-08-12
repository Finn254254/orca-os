# @orca/hardware-daemon

Abstraction layer for board-management hardware (temperature sensors,
fans, power state, LEDs, buttons, watchdog) that will eventually run on
physical Orca electronics. Because that hardware doesn't exist yet, the
only implementation today is `SimulatedHardwareBackend` — plausible,
evolving state (fans drift toward their target RPM, temperature responds
to fan speed) rather than static numbers, so the rest of the platform can
be built and tested against it now. A real MCU/board-management backend
implements the same `HardwareBackend` interface later; nothing above it
changes.

## Running

```bash
ORCA_HW_PORT=9090 npm run dev
```

## HTTP API (`/api/v1`)

`GET /temperatures`, `GET/POST /fans` (`POST /fans/:id {targetPct}`),
`GET/POST /power` (`POST /power {state: "on"|"standby"|"off"}`),
`GET/POST /leds` (`POST /leds/:id {on}`), `GET /buttons`,
`GET /watchdog`, `POST /watchdog/arm {timeoutMs}`, `POST /watchdog/disarm`,
`POST /watchdog/pet`.

## Scope for this phase

Intentionally **not** wired into Orca API/CLI/Dashboard cluster-wide yet.
Hardware Daemon is a per-node service (one instance per physical/simulated
node, same as Orca Agent) — routing a cluster-wide `orca power` command to
the *right* node's hardware daemon is the same per-node-endpoint-discovery
problem documented as a scope limitation in `models/README.md` and
`ai-gateway/README.md`. This phase delivers the abstraction + simulator
per the build instructions ("implement simulated hardware... allow the
rest of the platform to be developed and tested now"); cluster-wide
routing is follow-up work once that discovery problem is solved generally.

Run tests: `npx vitest run --root hardware-daemon` (from `orca-platform/`).
