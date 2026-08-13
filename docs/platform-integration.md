# Orca OS and Platform Integration

Orca OS owns the host operating-system layer. The Orca platform lives in `/orca-platform/` and must consume these interfaces without changing OS-owned files.

## OS-owned paths

- `/etc/orca-release` — operating-system identity
- `/etc/os-release` — standard Linux identity branded as Orca OS
- `/usr/local/bin/orca` — host CLI
- `/usr/lib/orca/` — host agent, authenticated management API, and support tooling
- `/var/lib/orca/` — persistent node identity and OS state
- `/run/orca/node.json` — live local-node record
- `/usr/lib/systemd/system/orca-*.service` — OS service definitions

## Local management interface

The host agent owns the local node record. The read-only API listens on guest port 9876 so the development VM's QEMU user-network forwarding can reach it:

- `GET /healthz` returns public, minimal API health.
- Authenticated `GET /v1/node` returns the live node record.
- `GET /v1/nodes` returns a combined local-node and enrolled-peer registry.
- `GET /v1/hardware` returns architecture, kernel, CPU, memory, root-storage, and virtualization inventory.
- `GET /v1/platform` returns device-tree/DMI board identity, firmware type, physical network interfaces, and thermal zones.
- `GET /v1/health` returns agent state, uptime, one-minute load, and sample timestamp.
- `GET /v1/peers` returns the locally enrolled peer records.
- `GET /v1/status` returns agent state, local node ID, and enrolled-peer count.

Every `/v1/*` request requires `Authorization: Bearer TOKEN`; retrieve the local token only through an authenticated administrative path such as `orca api token`. The QEMU launcher forwards this port only to host loopback (`127.0.0.1:9876`). Bearer authentication does not encrypt HTTP, so physical deployments must firewall the port and add TLS or an authenticated encrypted overlay before remote use. Platform services must not alter the OS state directory directly. Automatic discovery, scheduling, and user-facing APIs belong to the platform layer.

The OS services run with systemd filesystem, device, kernel, privilege, capability, task, and file-descriptor restrictions. The API runs as the dedicated unprivileged `orca-api` user, has read-only access to Orca records, and is limited to IP socket families.

The `/v1/node` record is written atomically and includes `schemaVersion`, `nodeId`, `hostname`, `architecture`, `kernel`, `agent`, `pid`, `resources.cpuCores`, `resources.memoryMiB`, and `updated`. Consumers must ignore unknown fields.

The additive `resources.cpu`, `resources.memory`, `resources.storage`, and `health` objects provide structured inventory and live metrics. Memory warnings use both absolute headroom (16 MiB warning, 8 MiB critical) and percentage thresholds (20%/10%). Root-storage thresholds are 128/64 MiB and 10%/5%. Load uses normalized five-minute thresholds of 1.5×/3× online CPU count to avoid one-core boot flapping. The accompanying `warnings` array contains stable machine-readable names; consumers must accept `healthy`, `degraded`, and `critical` status.

Peer records returned by `/v1/peers` must use schema version 1 and contain a valid node ID and `HOST:PORT` endpoint. Credentials are stored separately and never returned by this endpoint. `orca peer check` authenticates to the endpoint and requires the returned node identity to match the enrolled ID. Invalid or unrecognised records are ignored.

## CLI data contract

Platform installers and diagnostics may run `orca info --json` to read OS identity and hardware information. The result includes `schemaVersion`, `name`, `version`, `hostname`, `architecture`, `kernel`, `cpu`, `memoryMiB`, and `virtualization`. Consumers must ignore unknown fields so this schema can grow additively.

## Image integration

The image build copies OS files through `tools/install-rootfs.sh`. Platform components should be delivered independently, then installed by an explicit future OS integration package rather than added to the base image implicitly.

## Compatibility rule

Changes to the OS interface should be additive where possible. If a breaking change becomes necessary, document it here before platform code depends on it.
