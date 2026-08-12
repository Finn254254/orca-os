# Orca OS Integration Requirements

Orca Platform runs above Orca OS. This document records what the platform
needs from the OS layer, without modifying OS-owned code directly. GPT (or
whoever owns `orca-os` outside `orca-platform/`) should treat this as a
requirements list, not a to-do list to blindly implement.

## Orca Agent

- **Service definition**: Orca OS should ship a systemd unit (or equivalent
  supervisor) that starts `orca-platform/agent` (`node dist/index.js` after
  build, or `tsx src/index.js` in dev) at boot, restarts it on failure, and
  passes configuration via environment variables (`ORCA_CONTROL_URL`,
  `ORCA_CLUSTER_TOKEN`, `ORCA_NODE_NAME`, `ORCA_NODE_GROUP`).
- **Host metrics access**: the agent currently reads CPU/RAM/disk/network via
  the `systeminformation` npm package, which works on stock Linux without
  special privileges for most fields. GPU/temperature reporting will need
  read access to `/sys/class/hwmon` and vendor tooling (`nvidia-smi`, etc.)
  where available; Orca OS images should include those where applicable.
- **Orca version reporting**: the agent reports `orcaVersion` from
  `ORCA_OS_VERSION` env var or a version file; Orca OS should expose its
  version at a well-known path (proposed: `/etc/orca/os-release` or similar)
  so the agent doesn't have to guess.

## Orca Hardware Daemon

- Once physical Orca hardware exists, the hardware daemon needs a real
  transport to on-board sensors/MCUs (I2C/SPI/serial device paths, or a
  vendor SDK). Until then it runs against a built-in simulator. Orca OS
  should expose whatever device nodes/permissions the eventual real driver
  needs; the interface is defined in `hardware-daemon/src/types.ts` so a
  real backend can be swapped in without changing consumers.

## Orca Update

- Orca Update (`orca-platform/update`) manages *cluster-wide* version
  tracking, rollout sequencing, and rollback requests. It does **not**
  perform the actual OS image installation. It expects Orca OS to expose an
  "installer" interface it can shell out to or call over a local socket —
  something like `orca-os-updater apply <image-ref>` /
  `orca-os-updater rollback`. Until that exists, Update's installer adapter
  is a pluggable interface with a logging-only default implementation.

## Orca CLI naming

- Orca OS already defines a local `orca` CLI (`/cli` at the repo root) for
  single-machine administration talking to `orcad`. Orca Platform's CLI
  (`orca-platform/cli`) is a *cluster-wide* CLI talking to Orca API, also
  invoked as `orca`. These are two different binaries with overlapping
  names and some overlapping subcommands (`status`, `nodes`, `services`).
  This needs a resolution before general release — options include
  namespacing platform commands, having the OS CLI delegate to the platform
  CLI when Orca API is reachable, or merging them into one binary. Recorded
  here rather than resolved unilaterally since it affects OS-owned code.

## Networking

- Mesh communication (Agent -> Control) assumes nodes can reach Control's
  configured URL over TCP. Orca OS should ensure outbound connectivity (and
  ideally mDNS/local DNS for `orca-control.local`-style discovery) is
  available by default on Orca nodes.

## App Backend (mobile/desktop client discovery)

- `GET /api/v1/app/discover` (unauthenticated) lets a mobile/desktop
  client verify a server it already has an address for, but Orca Platform
  doesn't broadcast that address — a client currently needs one entered
  manually (IP/hostname, or a QR code generated out-of-band). Real
  zero-configuration discovery (a client on the same LAN finding an Orca
  API server with no address at all) needs Orca OS to advertise a service
  over mDNS/Bonjour (e.g. `_orca-api._tcp.local`) so `/app/discover` has
  something to be reached through in the first place. Until that exists,
  "discovery" here means "verify," not "find."
