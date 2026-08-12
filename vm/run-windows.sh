#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${ORCA_IMAGE:-$project_root/out/orca-os-x86_64.raw}"
memory="${ORCA_VM_MEMORY:-4096}"
cpus="${ORCA_VM_CPUS:-4}"
vars_copy="${ORCA_OVMF_VARS_COPY:-$project_root/out/OVMF_VARS.fd}"
serial="${ORCA_VM_SERIAL:-mon:stdio}"
ssh_port="${ORCA_VM_SSH_PORT:-2222}"
api_port="${ORCA_VM_API_PORT:-9876}"
mac="${ORCA_VM_MAC:-02:4f:52:43:41:00}"
pid_file="${ORCA_VM_PID_FILE:-}"
overlay="${ORCA_VM_OVERLAY:-$project_root/out/orca-vm.qcow2}"

fail() {
  echo "$*" >&2
  exit 1
}

to_wsl_path() {
  local path="$1"
  if [[ "$path" =~ ^[A-Za-z]:[\\/] ]]; then
    wslpath -u "$path"
  else
    printf '%s\n' "$path"
  fi
}

find_windows_qemu() {
  local candidate discovered
  for candidate in \
    "${ORCA_QEMU_WINDOWS:-}" \
    /mnt/c/msys64/ucrt64/bin/qemu-system-x86_64.exe \
    /mnt/c/Program\ Files/qemu/qemu-system-x86_64.exe; do
    [[ -n "$candidate" ]] || continue
    candidate="$(to_wsl_path "$candidate")"
    [[ -x "$candidate" || -f "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  done
  if command -v cmd.exe >/dev/null; then
    discovered="$(cmd.exe /d /c 'where qemu-system-x86_64.exe' 2>/dev/null | tr -d '\r' | head -n 1)"
    [[ -n "$discovered" ]] && to_wsl_path "$discovered" && return 0
  fi
  return 1
}

for port in "$ssh_port" "$api_port"; do
  [[ "$port" =~ ^[0-9]+$ ]] && (( port >= 1 && port <= 65535 )) ||
    fail "VM forwarded ports must be between 1 and 65535."
done
[[ "$memory" =~ ^[0-9]+$ ]] && ((10#$memory >= 128 && 10#$memory <= 65536)) ||
  fail "VM memory must be between 128 and 65536 MiB."
[[ "$cpus" =~ ^[0-9]+$ ]] && ((10#$cpus >= 1 && 10#$cpus <= 64)) ||
  fail "VM CPU count must be between 1 and 64."
if [[ ! "$mac" =~ ^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$ ]]; then
  fail "VM MAC must contain six hexadecimal octets."
fi
first_octet="${mac%%:*}"
first_octet=$((16#$first_octet))
(( (first_octet & 1) == 0 && (first_octet & 2) == 2 )) ||
  fail "VM MAC must be a locally administered unicast address."

[[ -f "$image" ]] || fail "Image not found: $image. Run 'make image' first."
command -v wslpath >/dev/null || fail "run-windows.sh must be run from WSL."

qemu="$(find_windows_qemu || true)"
[[ -n "$qemu" && -f "$qemu" ]] || fail \
  "Windows QEMU was not found. Set ORCA_QEMU_WINDOWS to qemu-system-x86_64.exe."

qemu_root="$(cd "$(dirname "$qemu")/.." && pwd)"
qemu_img="$qemu_root/bin/qemu-img.exe"
ovmf_code="$(to_wsl_path "${ORCA_OVMF_CODE:-$qemu_root/share/qemu/edk2-x86_64-code.fd}")"
ovmf_vars="$(to_wsl_path "${ORCA_OVMF_VARS:-$qemu_root/share/qemu/edk2-i386-vars.fd}")"
[[ -f "$ovmf_code" ]] || fail "UEFI code firmware not found: $ovmf_code"
[[ -f "$ovmf_vars" ]] || fail "UEFI variable template not found: $ovmf_vars"

if [[ ! -f "$vars_copy" ]]; then
  mkdir -p "$(dirname "$vars_copy")"
  cp "$ovmf_vars" "$vars_copy"
fi

image_windows="$(wslpath -w "$image")"
disk_windows="$image_windows"
disk_format="raw"
if [[ "$overlay" != "none" ]]; then
  disk_windows="$(wslpath -w "$overlay")"
  disk_format="qcow2"
fi
code_windows="$(wslpath -w "$ovmf_code")"
vars_windows="$(wslpath -w "$vars_copy")"
if [[ "$serial" == file:* ]]; then
  serial_file="${serial#file:}"
  mkdir -p "$(dirname "$serial_file")"
  serial="file:$(wslpath -w "$serial_file")"
fi
nic="user,model=virtio-net-pci,mac=$mac,hostfwd=tcp:127.0.0.1:${ssh_port}-:22,hostfwd=tcp:127.0.0.1:${api_port}-:9876"

qemu_args=(
  -accel whpx
  -machine q35
  -m "$memory"
  -smp "$cpus"
  -drive "if=pflash,format=raw,readonly=on,file=$code_windows"
  -drive "if=pflash,format=raw,file=$vars_windows"
  -drive "file=$disk_windows,format=$disk_format,if=virtio"
  -nic "$nic"
  -serial "$serial"
)

if [[ -n "$pid_file" ]]; then
  mkdir -p "$(dirname "$pid_file")"
  qemu_args+=( -pidfile "$(wslpath -w "$pid_file")" )
fi

if [[ "${ORCA_VM_HEADLESS:-0}" == "1" ]]; then
  qemu_args+=( -display none )
fi

if [[ "${1:-}" == "--dry-run" ]]; then
  printf '%q ' "$qemu" "${qemu_args[@]}"
  printf '\n'
  exit 0
fi

if [[ ! -e /proc/sys/fs/binfmt_misc/WSLInterop ]]; then
  echo "Restoring WSL Windows-executable interoperability..." >&2
  printf ':WSLInterop:M::MZ::/init:P' | sudo tee /proc/sys/fs/binfmt_misc/register >/dev/null
fi

if [[ "$overlay" != "none" ]]; then
  [[ -f "$qemu_img" ]] || fail "Windows qemu-img was not found: $qemu_img"
  marker="$overlay.base.sha256"
  base_sha256="$(sha256sum "$image" | awk '{print $1}')"
  if [[ -f "$overlay" ]]; then
    [[ -f "$marker" && "$(tr -d '[:space:]' < "$marker")" == "$base_sha256" ]] || fail \
      "VM overlay belongs to a different base image. Run 'make vm-reset' before launching the rebuilt image."
  else
    mkdir -p "$(dirname "$overlay")"
    echo "Creating persistent VM overlay: $overlay"
    "$qemu_img" create -q -f qcow2 -F raw -b "$image_windows" "$disk_windows"
    printf '%s\n' "$base_sha256" > "$marker"
  fi
fi

echo "Starting Orca OS with Windows QEMU/WHPX (SSH 127.0.0.1:$ssh_port, API 127.0.0.1:$api_port)."
exec "$qemu" "${qemu_args[@]}"
