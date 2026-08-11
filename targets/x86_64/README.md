# x86-64 target

This is the first Orca OS target. It produces a UEFI-bootable QEMU-compatible raw disk image from `build/mkosi.conf`.

The target is intentionally generic: it uses Q35 virtio devices and does not embed hardware-specific drivers or board assumptions. ARM64 support will live beside this target rather than altering the x86-64 image definition.
