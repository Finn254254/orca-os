#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
smoke_script="${ORCA_VM_SMOKE_SCRIPT:-$project_root/vm/smoke-test-windows.sh}"
memory="${ORCA_VM_LOWMEM_MEMORY:-1536}"
cpus="${ORCA_VM_LOWMEM_CPUS:-2}"
ssh_port="${ORCA_VM_LOWMEM_SSH_PORT:-2422}"
api_port="${ORCA_VM_LOWMEM_API_PORT:-9978}"

[[ "$memory" =~ ^[0-9]+$ ]] && ((10#$memory >= 128 && 10#$memory <= 2048)) || {
  echo "Low-memory smoke size must be between 128 and 2048 MiB." >&2
  exit 2
}
[[ "$cpus" =~ ^[0-9]+$ ]] && ((10#$cpus >= 1 && 10#$cpus <= 4)) || {
  echo "Low-memory smoke CPU count must be between 1 and 4." >&2
  exit 2
}

echo "Running the x86-64 constrained profile at ${memory} MiB/${cpus} CPU(s) (this measures regressions; it does not prove a V3s image fits)."
ORCA_VM_MEMORY="$memory" \
ORCA_VM_CPUS="$cpus" \
ORCA_VM_SSH_PORT="$ssh_port" \
ORCA_VM_API_PORT="$api_port" \
ORCA_VM_MAC="${ORCA_VM_LOWMEM_MAC:-02:4f:52:43:4c:01}" \
ORCA_VM_BOOT_TIMEOUT="${ORCA_VM_LOWMEM_BOOT_TIMEOUT:-240}" \
ORCA_VM_OVERLAY="${ORCA_VM_OVERLAY:-$project_root/out/orca-vm-smoke.lowmem.$$.qcow2}" \
ORCA_OVMF_VARS_COPY="${ORCA_OVMF_VARS_COPY:-$project_root/out/OVMF_VARS.smoke-lowmem.fd}" \
ORCA_VM_LOG="${ORCA_VM_LOG:-$project_root/out/orca-vm-lowmem-boot.log}" \
ORCA_VM_PID_FILE="${ORCA_VM_PID_FILE:-$project_root/out/orca-vm-lowmem.pid}" \
  exec "$smoke_script"
