# Orca OS

Orca OS is a minimal, appliance-style Linux platform for Orca servers and compute nodes.

Milestone 1 provides a reproducible x86-64 VM image definition, the `orca` command-line tool, an identity file at `/etc/orca-release`, and the `orca-agent` systemd service. The image is designed for QEMU first, with ARM64 support kept as a separate future target.

## Quick start

Run the host-side tests:

```bash
make test
```

Build an x86-64 raw disk image on a Linux host with [mkosi](https://github.com/systemd/mkosi) installed:

```bash
make image
```

The build verifies that the artifact is a GPT image with an EFI System Partition and writes a SHA-256 checksum beside it.
Before image creation, it also verifies the staged root filesystem contains and enables every Orca system component.

Run the resulting image with QEMU:

```bash
make vm
```

The full Windows setup is in [docs/windows-vm.md](docs/windows-vm.md).

## Repository layout

- `build/` image definition and build entrypoint
- `cli/` the `orca` CLI
- `services/` Orca background service and systemd unit
- `config/` operating-system identity files
- `tools/` root filesystem installation tooling
- `vm/` QEMU launcher
- `tests/` host-side integration tests
- `docs/` operator documentation
- `targets/` architecture-specific work, beginning with x86-64

## Commands

```text
orca info       Print Orca and operating-system identity
orca status     Show Orca service and node status
orca version    Print the Orca OS version
orca node id    Print the persistent node identity
orca node show  Print the structured local node record
```

`orca-agent` generates a persistent node ID in `/var/lib/orca/node-id` and publishes a machine-readable local record at `/run/orca/node.json`. This stable interface is the foundation for Milestone 2 node discovery and the later web dashboard.

Use `orca peer add NODE_ID HOST:PORT` to enroll a node in the persistent local registry. This is the first management path before automatic discovery is added.

The local management API serves `GET /healthz` and `GET /v1/node` on `127.0.0.1:9876`. It is intentionally local-only until authenticated remote node management is implemented.

## Roadmap

1. Bootable x86-64 VM image
2. Node discovery and management
3. Local AI runtime and model management
4. Web management dashboard
5. ARM64 images for Orca hardware

## License

Apache-2.0. See [LICENSE](LICENSE).
