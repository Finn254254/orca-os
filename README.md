# Orca OS

Orca OS is a minimal, appliance-style Linux platform for Orca servers and compute nodes.

The current development platform provides a reproducible x86-64 VM image, persistent node identity and credentials, hardware/health reporting, an authenticated management API, key-only SSH, support bundles, resource-budget reporting, and one- and two-node Windows/WHPX test workflows. The planned Allwinner V3s production image remains a separate 32-bit ARM/U-Boot target; the x86 UEFI development image is not intended to be flashed to that board.

## Quick start

Run the host-side tests:

```bash
make test
```

Build an x86-64 raw disk image on a Linux host with [mkosi](https://github.com/systemd/mkosi) installed:

```bash
make image
```

The build always produces `out/orca-os-x86_64.raw`. It also creates a workspace-local development SSH key at `out/orca-vm.id_ed25519`, verifies that the artifact is a GPT image with an EFI System Partition, enforces explicit disk/initrd/EFI regression budgets, then writes a SHA-256 checksum, size report, and JSON release manifest beside it.
Before image creation, it also verifies the staged root filesystem contains and enables every Orca system component.

Run the resulting image with QEMU:

```bash
make vm
```

Inside WSL, `make vm` automatically launches Windows QEMU with WHPX. On a native Linux host it uses KVM with a TCG fallback. Connect to the running development VM with:

```bash
make vm-ssh
```

Windows launches use `out/orca-vm.qcow2` as a persistent writable overlay. The verified raw image remains unchanged and can seed additional nodes. After rebuilding the base image, reset the old VM state once with `make vm-reset` before the next launch.

Run the automated headless boot check, which waits for the image's serial readiness marker:

```bash
make vm-smoke
```

The smoke test also calls the guest management API through QEMU's loopback-only port forwarding, confirming that both the OS and its core services started successfully.
It verifies that unauthenticated management calls are rejected, obtains the persistent bearer token over key-only SSH, exercises the authenticated API, creates a secret-redacted support bundle, and shuts down the owned QEMU process safely.

Two additional Windows/WHPX checks are available:

```bash
make vm-smoke-lowmem   # measured 1536 MiB/two-vCPU x86 baseline
make vm-smoke-cluster  # two disposable, independently identified nodes
```

The constrained-memory run catches x86 userspace regressions but does not prove that the current Debian/UEFI image fits the V3s. On the reference Windows/WHPX host, 1536 MiB/two vCPUs passes while 1024 MiB and lower fail in the generic Debian initrd before Orca starts. The cluster run proves distinct identities, authenticated API access, explicit peer enrollment, and bidirectional reachability; it is not automatic LAN discovery.

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

The design-time hardware contract for the planned custom Allwinner V3s board is in [`targets/allwinner-v3s/BOARD-REQUIREMENTS.md`](targets/allwinner-v3s/BOARD-REQUIREMENTS.md). It records the schematic, boot/recovery, DRAM, PHY, MAC-address, power, watchdog, thermal, storage, and device-tree information the eventual board target will require.

## Commands

```text
orca info       Print Orca and operating-system identity; add --json for structured output
orca status     Show Orca service and node status
orca hardware   Show CPU, memory, root storage, and virtualization inventory
orca platform   Show board identity, firmware, physical NICs, and thermal zones
orca health     Show node uptime and load health metrics
orca nodes      List the local node and explicitly enrolled peers
orca services   Show managed service states; add --json for automation
orca service    Show or restart an allowlisted service
orca logs       Show up to 500 recent lines for an allowlisted service
orca network    Show configured global IPv4 interfaces; add --json
orca doctor     Check files, services, networking, node state, and API health
orca version    Print the Orca OS version
orca node id    Print the persistent node identity
orca node show  Print the structured local node record
orca node rename HOSTNAME  Provision a durable node hostname
orca api token  Explicitly print the local API bearer token
orca api rotate-token  Atomically rotate the API bearer token
orca peer add NODE_ID HOST:PORT --token-stdin  Enroll a peer credential without putting it in argv
orca peer check NODE_ID  Authenticate to a peer and verify its identity
orca resources  Report memory, processes, and Orca service RSS/PSS as JSON
orca support [OUTPUT.tar.gz]  Create a bounded, secret-redacted diagnostic archive
```

`orca-agent` generates a persistent node ID in `/var/lib/orca/node-id` and publishes a machine-readable local record at `/run/orca/node.json`. This stable interface is the foundation for Milestone 2 node discovery and the later web dashboard.

Use `printf '%s\n' "$REMOTE_TOKEN" | orca peer add NODE_ID HOST:PORT --token-stdin` to enroll a node and its API credential. `orca peer check NODE_ID` then makes an authenticated request and requires the remote node to return the enrolled identity. Enrollment remains explicit; automatic discovery and trust establishment are not implemented.

The management API serves public `GET /healthz` plus authenticated `GET /v1/node`, `GET /v1/nodes`, `GET /v1/hardware`, `GET /v1/platform`, `GET /v1/health`, `GET /v1/peers`, and `GET /v1/status` on guest port 9876. Every `/v1/*` request requires `Authorization: Bearer TOKEN`. The development QEMU launcher exposes it only as host `127.0.0.1:9876`. Bearer tokens are not a substitute for transport encryption: a future physical-board LAN profile must add TLS or an authenticated encrypted overlay before exposing this API remotely.

## Roadmap

1. Bootable x86-64 VM image
2. Authenticated node management and discovery
3. Local AI runtime and model management
4. Web management dashboard
5. A dedicated 32-bit ARM/U-Boot image for the Allwinner V3s board

## License

Apache-2.0. See [LICENSE](LICENSE).
