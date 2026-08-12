# Orca OS Roadmap

## v0.1 VM foundation

- define architecture and repository structure
- create repeatable x86-64 image build
- boot image in a VM
- establish Orca hostname and OS identity
- install and start `orca-agent` and `orca-api`
- implement `orca status`
- add automated smoke tests
- stable raw artifact plus persistent/disposable qcow2 overlays
- Windows QEMU/WHPX launcher with discovered UEFI and Windows profile paths

## v0.2 Node management

- persistent node identity
- hardware inventory (implemented for local nodes)
- health metrics (implemented for local nodes)
- local management API (implemented)
- persistent bearer authentication (implemented)
- explicit credentialed peer checks (implemented)
- two-node Windows/WHPX smoke harness (implemented)
- LAN node discovery
- encrypted transport and trust bootstrap for physical LANs
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
- first ARM hardware image (initial custom Allwinner V3s target is 32-bit ARM)
- hardware-specific provisioning
- production console/SSH policy without development root autologin
- minimal package manifest and native low-memory management daemon if required
- watchdog integration and bounded/volatile logging

## Long term

- Orca compute scheduling
- distributed inference support where runtimes allow it
- storage and network node roles
- fleet policy
- custom Orca hardware integration
