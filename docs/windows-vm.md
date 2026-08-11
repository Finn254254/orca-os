# Testing Orca OS on Windows

## Requirements

Install [QEMU for Windows](https://www.qemu.org/download/#windows) and add its installation directory to `PATH`. Build the image from WSL2 or another Linux machine, then copy `out/orca-os-x86_64.raw` to Windows.

Use the UEFI firmware files installed with QEMU or edk2: `OVMF_CODE.fd` and `OVMF_VARS.fd`. Copy `OVMF_VARS.fd` before each clean test VM because it is writable guest state.

## Launch with PowerShell

```powershell
qemu-system-x86_64.exe `
  -machine q35,accel=whpx `
  -cpu max `
  -m 2048 `
  -smp 2 `
  -drive if=pflash,format=raw,readonly=on,file=OVMF_CODE.fd `
  -drive if=pflash,format=raw,file=ORCA_OVMF_VARS.fd `
  -drive file=orca-os-x86_64.raw,format=raw,if=virtio `
  -nic user,model=virtio-net-pci,hostfwd=tcp::2222-:22 `
  -serial mon:stdio
```

Enable **Windows Hypervisor Platform** in Windows Features before using `accel=whpx`. If it is unavailable, replace `accel=whpx` with `accel=tcg`; it will be slower but works without virtualization acceleration.

After logging in, verify the Milestone 1 components:

```bash
orca info
orca status
systemctl status orca-agent
```

The current x86-64 image is a development image and automatically logs root into the local QEMU serial console. Do not expose its console or use this image as a production host. Production authentication is an Orca OS hardening milestone.

From Windows, once SSH is configured in the VM, connect with:

```powershell
ssh -p 2222 root@localhost
```
