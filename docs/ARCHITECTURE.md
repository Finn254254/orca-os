# Orca OS architecture

## Current system

Orca OS is an appliance-style Linux platform with a small management layer. Linux supplies the kernel, drivers, networking, storage, and process isolation. Architecture-neutral Orca components currently provide:

- `orca-first-boot`: initializes persistent node credentials once;
- `orca-agent`: maintains node identity and publishes hardware, platform, and health state;
- `orca-api`: serves the read-only authenticated management API;
- `orca`: provides local administration, diagnostics, peer enrollment, and support tooling;
- systemd-networkd and key-only SSH: provide the development VM's network and remote shell.

Persistent state lives under `/var/lib/orca` with mode 0700. Runtime records live under `/run/orca` and are recreated after boot. The API token and peer tokens are separate permission-restricted files and are never embedded in public node or peer records.

## Boot and readiness

Readiness is deliberately split:

1. `orca-first-boot.service` creates or validates the API token.
2. SSH, the agent, and API start without requiring Ethernet.
3. `orca-core-ready.service` emits `ORCA_CORE_READY` when local/offline management works.
4. Network-online waiting is bounded to 20 seconds.
5. `orca-ready.service` emits `ORCA_OS_READY` for the full development smoke workflow.

A missing cable therefore cannot hold the future appliance in an unbounded boot wait.

## Management security

`GET /healthz` exposes only liveness. Every `/v1/*` route requires the persistent bearer token and rejects missing or incorrect credentials. Requests are size- and time-bounded, request bodies are rejected, and the server handles one request at a time to avoid unbounded worker creation on small systems. The network API runs as the dedicated `orca-api` user and has read-only access to its allowlisted runtime and persistent records.

The x86 launcher forwards API and SSH ports to Windows loopback only. HTTP bearer authentication does not provide confidentiality, so physical-board LAN management must use TLS or an authenticated encrypted overlay. Explicit peer enrollment records an expected node ID, endpoint, and separate credential; `orca peer check` verifies both reachability and returned identity. Enrollment does not imply automatic discovery or a distributed cluster protocol.

## Resource model

The current x86 image is a development environment, not the V3s production payload. Service accounting and task/file-descriptor limits are enabled now, the journal is volatile and capped at 4 MiB, and `orca resources` exposes process count, available memory, Orca RSS/PSS, and cgroup memory. `make vm-smoke-lowmem` tracks regressions under constrained x86 RAM.

Python remains the largest Orca-specific runtime cost. If the manufactured board's measured usable RAM is near the V3s minimum envelope, the agent and API should be consolidated into a small native daemon and the production package set must exclude UEFI/QEMU/development-only components.

## Target separation

The x86-64 development target uses Q35, UEFI, virtio, Windows QEMU/WHPX, serial root autologin, and a generated root SSH key. The future Allwinner V3s target is 32-bit ARM and requires its own SPL/U-Boot, mainline kernel configuration, DTB, storage layout, recovery path, production console policy, and minimal userspace manifest. Common Orca CLI/API schemas can be reused; boot artifacts and security profiles cannot.
