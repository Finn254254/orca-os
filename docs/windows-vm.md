# Testing Orca OS on Windows with WSL

This is the supported local VM workflow. The image is built inside WSL and launched directly from WSL with Windows QEMU/WHPX. It does not use or require KVM, and it does not copy the image into a hardcoded Windows user directory.

## One-time Windows setup

1. Enable **Windows Hypervisor Platform** in “Turn Windows features on or off”, then reboot if Windows requests it.
2. Install WSL2 and a Linux distribution.
3. Install Windows QEMU. The launcher automatically checks `C:\msys64\ucrt64\bin`, the standard QEMU Program Files directory, and Windows `PATH`. For MSYS2 UCRT64, install QEMU from an UCRT64 shell:

   ```bash
   pacman -S mingw-w64-ucrt-x86_64-qemu
   ```

4. Ensure the Windows OpenSSH Client optional feature is installed. Windows 10 and 11 include `curl.exe`.

The known-good MSYS2 firmware names are `edk2-x86_64-code.fd` and `edk2-i386-vars.fd` under QEMU's `share/qemu` directory. The launcher discovers them relative to the QEMU executable.

## Build in WSL

Open the WSL distribution that contains the repository:

```bash
cd ~/orca-os
sudo apt-get update
sudo apt-get install -y mkosi fdisk openssh-client
make test
make image
```

The final files are:

- `out/orca-os-x86_64.raw` — the VM disk image
- `out/orca-os-x86_64.raw.sha256` — checksum
- `out/orca-os-x86_64.raw.manifest.json` — release manifest
- `out/orca-os-x86_64.size-report.json` — enforced raw/initrd/EFI size-budget result
- `out/orca-vm.id_ed25519` — generated development VM SSH key

When connecting, the helper copies this key to the detected Windows Local AppData `OrcaOS` directory and applies a user-only ACL required by Windows OpenSSH. No Windows username is hardcoded.

mkosi appends the disk-format suffix itself, so the configured output base name deliberately has no `.raw` suffix. This prevents the former `orca-os-x86_64.raw.raw` result.

## Launch and connect

From WSL:

```bash
cd ~/orca-os
make vm
```

`make vm` detects WSL and starts Windows `qemu-system-x86_64.exe` with Q35, WHPX, UEFI pflash, a virtio disk, and a virtio network adapter. The image uses `systemd-networkd` to bring `enp0s2` up and obtain IPv4 through QEMU DHCP automatically.

The launcher creates `out/orca-vm.qcow2` for persistent VM changes. The verified `out/orca-os-x86_64.raw` remains read-only as the backing image, so first-boot identity, SSH host keys, and later node state do not contaminate the release artifact. If you rebuild the raw image while an older overlay exists, the launcher stops safely; run `make vm-reset` once to discard that old VM state.

In a second WSL terminal, connect with the generated key through the Windows OpenSSH client:

```bash
cd ~/orca-os
make vm-ssh
```

The forwarded endpoints are loopback-only on Windows:

- `127.0.0.1:2222` → guest SSH port 22
- `127.0.0.1:9876` → guest Orca API port 9876

From Windows PowerShell, the API health check is:

```powershell
Invoke-RestMethod http://127.0.0.1:9876/healthz
```

It returns a JSON object with `status` equal to `ok`.

`/healthz` is intentionally the only public endpoint. Retrieve the persistent API token through key-only SSH, then use it for management calls:

```powershell
$key = Join-Path $env:LOCALAPPDATA 'OrcaOS\orca-vm.id_ed25519'
$token = (ssh.exe -i $key -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL root@127.0.0.1 'orca api token').Trim()
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Headers $headers http://127.0.0.1:9876/v1/status
```

Do not paste the token into logs, issue trackers, or support bundles. Rotate it inside the guest with `orca api rotate-token`; any enrolled peers must then be updated.

## Automated smoke test

Stop any manually running Orca VM, then run:

```bash
cd ~/orca-os
make vm-smoke
```

The smoke test starts a headless Windows QEMU VM with a disposable overlay and verifies all of the following before shutting it down:

1. systemd reaches the Orca readiness unit.
2. `enp0s2` has a global IPv4 address from DHCP.
3. `systemd-networkd`, SSH, `orca-agent`, and `orca-api` are active.
4. Key-based SSH works through host port 2222.
5. Public `GET /healthz` responds and unauthenticated `/v1/*` calls return HTTP 401.
6. Authenticated node, hardware, health, platform, and node-list API calls work.
7. A bounded support archive contains diagnostics and no API token.
8. Orca resource reporting, service restart recovery, and diagnostics work.

Logs are written to `out/orca-vm-boot.log` and `out/orca-vm-ssh-check.log`.

Run a constrained regression profile with:

```bash
make vm-smoke-lowmem
```

It defaults to the measured passing Windows/WHPX baseline of 1536 MiB and two vCPUs. Override the rungs with, for example, `ORCA_VM_LOWMEM_MEMORY=2048 ORCA_VM_LOWMEM_CPUS=2 make vm-smoke-lowmem`. On the reference host, 1024 MiB and lower fail during the generic Debian initrd switch-root, before Orca services start. This test covers the x86 development image only; it does not certify the V3s kernel, U-Boot flow, or 32-bit image.

Run two disposable nodes with separate overlays, UEFI variable stores, MAC addresses, forwarded ports, identities, and credentials:

```bash
make vm-smoke-cluster
```

The two-node harness uses ports 2322/9976 and 2323/9977 by default. It authenticates both APIs, requires different node IDs, enrolls each node into the other without placing tokens in process arguments, proves bidirectional reachability, and requires graceful shutdown. The test uses QEMU's host gateway as a local rendezvous; shared-L2 discovery remains future work.

## Overrides and troubleshooting

The launcher detects paths; it does not assume a Windows username. If QEMU is installed elsewhere, pass its Windows or WSL path explicitly:

```bash
ORCA_QEMU_WINDOWS='D:\tools\qemu\qemu-system-x86_64.exe' make vm
```

Useful overrides are `ORCA_VM_MEMORY`, `ORCA_VM_CPUS`, `ORCA_VM_SSH_PORT`, `ORCA_VM_API_PORT`, `ORCA_VM_MAC`, `ORCA_OVMF_CODE`, and `ORCA_OVMF_VARS`. A supplied MAC must be a locally administered unicast address.

If WSL's Windows-executable registration is missing, the launcher restores it through `sudo` before starting QEMU. This avoids the `cannot execute binary file` failure that can otherwise occur after a WSL update or restart.

If QEMU reports that a forwarded port is in use, stop the other VM or select alternate ports consistently, for example:

```bash
ORCA_VM_SSH_PORT=2223 ORCA_VM_API_PORT=9877 make vm
```

The image is a development image: serial-console root autologin, root SSH access, UEFI, QEMU guest tooling, and its generated local SSH key are not production-board settings. Never expose ports 2222 or 9876 beyond the Windows loopback interface. The bearer token protects management authorization but the VM API is still plain HTTP; physical-board remote access requires encrypted transport.
