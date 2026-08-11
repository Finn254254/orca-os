# Orca OS Roadmap

## v0.1 VM foundation

- define architecture and repository structure
- create repeatable x86-64 image build
- boot image in a VM
- establish Orca hostname and OS identity
- install and start `orcad`
- implement `orca status`
- add automated smoke tests

## v0.2 Node management

- persistent node identity
- hardware inventory
- health metrics
- local management API
- LAN node discovery
- trusted-node enrollment
- `orca nodes` and `orca hardware`

## v0.3 Local AI

- model runtime abstraction
- initial Ollama-compatible adapter
- model inventory
- model start/stop controls
- accelerator detection
- `orca models`

## v0.4 Management

- web management interface
- service/container controls
- logs and alerts
- multi-node overview

## v0.5 Appliance features

- signed update mechanism
- rollback/recovery design
- first ARM64 hardware image
- hardware-specific provisioning

## Long term

- Orca compute scheduling
- distributed inference support where runtimes allow it
- storage and network node roles
- fleet policy
- custom Orca hardware integration
