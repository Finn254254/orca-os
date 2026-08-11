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
```

## Roadmap

1. Bootable x86-64 VM image
2. Node discovery and management
3. Local AI runtime and model management
4. Web management dashboard
5. ARM64 images for Orca hardware

## License

Apache-2.0. See [LICENSE](LICENSE).
