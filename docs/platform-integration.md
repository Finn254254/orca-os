# Orca OS and Platform Integration

Orca OS owns the host operating-system layer. The Orca platform lives in `/orca-platform/` and must consume these interfaces without changing OS-owned files.

## OS-owned paths

- `/etc/orca-release` — operating-system identity
- `/etc/os-release` — standard Linux identity branded as Orca OS
- `/usr/local/bin/orca` — host CLI
- `/usr/lib/orca/` — host agent and loopback management API
- `/var/lib/orca/` — persistent node identity and OS state
- `/run/orca/node.json` — live local-node record
- `/usr/lib/systemd/system/orca-*.service` — OS service definitions

## Local management interface

The host agent owns the local node record. The local read-only API binds only to `127.0.0.1:9876`:

- `GET /healthz` returns API health.
- `GET /v1/node` returns the live node record.
- `GET /v1/peers` returns the locally enrolled peer records.

Platform services may read these endpoints locally. They must not expose them remotely or alter the OS state directory directly. Remote access, authentication, node discovery, scheduling, and user-facing APIs belong to the platform layer.

The `/v1/node` record is written atomically and includes `schemaVersion`, `nodeId`, `hostname`, `architecture`, `kernel`, `agent`, `pid`, `resources.cpuCores`, `resources.memoryMiB`, and `updated`. Consumers must ignore unknown fields.

## CLI data contract

Platform installers and diagnostics may run `orca info --json` to read OS identity and hardware information. The result includes `schemaVersion`, `name`, `version`, `hostname`, `architecture`, `kernel`, `cpu`, `memoryMiB`, and `virtualization`. Consumers must ignore unknown fields so this schema can grow additively.

## Image integration

The image build copies OS files through `tools/install-rootfs.sh`. Platform components should be delivered independently, then installed by an explicit future OS integration package rather than added to the base image implicitly.

## Compatibility rule

Changes to the OS interface should be additive where possible. If a breaking change becomes necessary, document it here before platform code depends on it.
