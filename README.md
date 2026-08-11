# Orca OS

Orca OS is a Linux-based operating system project for Orca compute systems, focused on local AI, node management, hardware monitoring, service orchestration, and simple administration.

## Initial targets

- x86-64 virtual machine development image
- ARM64 hardware images later
- Orca system daemon
- Orca CLI
- Node discovery and health monitoring
- Local AI runtime integration
- Web management interface
- Secure updates and recovery

## First milestone

Produce a bootable x86-64 VM development image with the Orca core service and CLI. This lets the software stack be developed and tested on a Windows PC before dedicated Orca hardware is ready.

## Repository layout

- `docs/` architecture, roadmap, and design decisions
- `build/` image build configuration and scripts
- `services/orcad/` Orca system daemon
- `cli/` Orca command-line interface
- `config/` default system configuration
- `tests/` VM and integration tests
- `.github/workflows/` automated validation and image builds

## Status

Early development.
