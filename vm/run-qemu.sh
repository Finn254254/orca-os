#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${ORCA_IMAGE:-$project_root/out/orca-os-x86_64.raw}"
memory="${ORCA_VM_MEMORY:-2048}"
cpus="${ORCA_VM_CPUS:-2}"
ovmf_code="${ORCA_OVMF_CODE:-}"
ovmf_vars="${ORCA_OVMF_VARS:-}"
ovmf_vars_copy="${ORCA_OVMF_VARS_COPY:-$project_root/out/OVMF_VARS.fd}"
serial="${ORCA_VM_SERIAL:-mon:stdio}"

find_firmware() {
  local candidate
  for candidate in "$@"; do
    [[ -f "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

[[ -f "$image" ]] || {
  echo "Image not found: $image. Run 'make image' first." >&2
  exit 1
}
command -v qemu-system-x86_64 >/dev/null || {
  echo "qemu-system-x86_64 is required." >&2
  exit 1
}

[[ -n "$ovmf_code" ]] || ovmf_code="$(find_firmware /usr/share/OVMF/OVMF_CODE.fd /usr/share/edk2/x64/OVMF_CODE.fd || true)"
[[ -n "$ovmf_vars" ]] || ovmf_vars="$(find_firmware /usr/share/OVMF/OVMF_VARS.fd /usr/share/edk2/x64/OVMF_VARS.fd || true)"
[[ -f "$ovmf_code" && -f "$ovmf_vars" ]] || {
  echo "UEFI firmware not found. Set ORCA_OVMF_CODE and ORCA_OVMF_VARS." >&2
  exit 1
}

if [[ ! -f "$ovmf_vars_copy" ]]; then
  mkdir -p "$(dirname "$ovmf_vars_copy")"
  cp "$ovmf_vars" "$ovmf_vars_copy"
fi

qemu_args=(
  -machine q35,accel=kvm:tcg
  -cpu max
  -m "$memory"
  -smp "$cpus"
  -drive "if=pflash,format=raw,readonly=on,file=$ovmf_code"
  -drive "if=pflash,format=raw,file=$ovmf_vars_copy"
  -drive "file=$image,format=raw,if=virtio"
  -nic user,model=virtio-net-pci,hostfwd=tcp::2222-:22
  -serial "$serial"
)

if [[ "${ORCA_VM_HEADLESS:-0}" == "1" ]]; then
  qemu_args+=( -display none )
fi

if [[ "${1:-}" == "--dry-run" ]]; then
  printf 'qemu-system-x86_64 %q ' "${qemu_args[@]}"
  printf '\n'
  exit 0
fi

exec qemu-system-x86_64 "${qemu_args[@]}"
