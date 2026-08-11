#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${ORCA_IMAGE:-$project_root/out/orca-os-x86_64.raw}"
memory="${ORCA_VM_MEMORY:-2048}"
cpus="${ORCA_VM_CPUS:-2}"

[[ -f "$image" ]] || {
  echo "Image not found: $image. Run 'make image' first." >&2
  exit 1
}
command -v qemu-system-x86_64 >/dev/null || {
  echo "qemu-system-x86_64 is required." >&2
  exit 1
}

exec qemu-system-x86_64 \
  -machine q35,accel=kvm:tcg \
  -cpu max \
  -m "$memory" \
  -smp "$cpus" \
  -drive "file=$image,format=raw,if=virtio" \
  -nic user,model=virtio-net-pci,hostfwd=tcp::2222-:22 \
  -serial mon:stdio
