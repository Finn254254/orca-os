#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${ORCA_IMAGE:-$project_root/out/orca-os-x86_64.raw}"
log_file="${ORCA_VM_LOG:-$project_root/out/orca-vm-boot.log}"
boot_timeout="${ORCA_VM_BOOT_TIMEOUT:-120}"
vars_copy="${ORCA_OVMF_VARS_COPY:-$project_root/out/OVMF_VARS.smoke.fd}"
api_port="${ORCA_VM_API_PORT:-9876}"
qemu_pid=""

cleanup() {
  if [[ -n "$qemu_pid" ]] && kill -0 "$qemu_pid" 2>/dev/null; then
    kill "$qemu_pid" 2>/dev/null || true
    wait "$qemu_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "$(dirname "$log_file")"
: > "$log_file"

ORCA_IMAGE="$image" \
ORCA_VM_HEADLESS=1 \
ORCA_VM_SERIAL="file:$log_file" \
ORCA_VM_API_PORT="$api_port" \
ORCA_OVMF_VARS_COPY="$vars_copy" \
  "$project_root/vm/run-qemu.sh" &
qemu_pid=$!

deadline=$((SECONDS + boot_timeout))
while (( SECONDS < deadline )); do
  if grep -q 'ORCA_OS_READY' "$log_file"; then
    if [[ "${ORCA_VM_SKIP_API_CHECK:-0}" == "1" ]] || python3 - "$api_port" <<'PY'
import json
import sys
import urllib.request

try:
    with urllib.request.urlopen(f"http://127.0.0.1:{sys.argv[1]}/healthz", timeout=1) as response:
        healthy = response.status == 200 and json.load(response) == {"status": "ok"}
except (OSError, ValueError):
    healthy = False
raise SystemExit(0 if healthy else 1)
PY
    then
      echo "Orca OS VM boot and management API smoke test passed."
      exit 0
    fi
  fi
  if ! kill -0 "$qemu_pid" 2>/dev/null; then
    wait "$qemu_pid" || true
    echo "QEMU exited before Orca OS reported ready." >&2
    tail -n 80 "$log_file" >&2
    exit 1
  fi
  sleep 1
done

echo "Timed out waiting for ORCA_OS_READY after ${boot_timeout}s." >&2
tail -n 80 "$log_file" >&2
exit 1
