# Orca OS Architecture

## Goal

Orca OS is a Linux distribution and management layer for Orca compute nodes. Linux provides the kernel, drivers, process model, networking, and hardware compatibility. Orca supplies the system identity, management services, local-AI integration, cluster behavior, administration tools, and eventually hardware-specific images.

## v0.1 architecture

1. Linux base
2. systemd service manager
3. `orcad` core daemon
4. `orca` command-line client
5. node identity and discovery
6. health and hardware telemetry
7. AI runtime adapter layer
8. service/container management
9. management API
10. later web management UI

## Development targets

### x86-64 VM

Primary development target. It should boot and run under a Windows-hosted hypervisor so most OS software can be developed before Orca hardware exists.

### ARM64

Secondary target after the VM stack is stable. Hardware-specific bootloader, kernel, device-tree, and driver configuration will live separately from common Orca services.

## Core daemon

`orcad` will become the local control plane for each machine. Planned responsibilities:

- expose node status
- maintain node identity
- report CPU, memory, storage, network, accelerator and temperature information where available
- discover trusted Orca nodes
- manage local Orca services
- expose a local management API
- provide hooks for model runtimes

## CLI

The `orca` CLI will communicate with `orcad`. Planned commands include:

- `orca status`
- `orca nodes`
- `orca hardware`
- `orca models`
- `orca services`
- `orca update`

## Security direction

Orca services should use least privilege. Remote management must require authentication. Cluster discovery must not imply trust. Update artifacts should eventually be signed and recoverable.
