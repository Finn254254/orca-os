#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${ORCA_IMAGE:-$project_root/out/orca-os-x86_64.raw}"
ssh_key="${ORCA_VM_SSH_KEY:-$project_root/out/orca-vm.id_ed25519}"
log_file="${ORCA_VM_LOG:-$project_root/out/orca-vm-boot.log}"
boot_timeout="${ORCA_VM_BOOT_TIMEOUT:-180}"
vars_copy="${ORCA_OVMF_VARS_COPY:-$project_root/out/OVMF_VARS.smoke.fd}"
ssh_port="${ORCA_VM_SSH_PORT:-2222}"
api_port="${ORCA_VM_API_PORT:-9876}"
qemu_pid=""
pid_file="${ORCA_VM_PID_FILE:-$project_root/out/orca-vm-smoke.pid}"
overlay="${ORCA_VM_OVERLAY:-$project_root/out/orca-vm-smoke.$$.qcow2}"
stop_helper="$project_root/vm/stop-windows-qemu.ps1"
windows_ssh=""
windows_powershell=""
ssh_key_windows=""

cleanup() {
  local status=$? windows_pid="" stopped=1 overlay_windows helper_windows
  trap - EXIT INT TERM
  set +e
  if [[ -n "$qemu_pid" ]] && kill -0 "$qemu_pid" 2>/dev/null; then
    if [[ -x "$windows_ssh" && -n "$ssh_key_windows" ]]; then
      "$windows_ssh" -T -i "$ssh_key_windows" -p "$ssh_port" \
        -o BatchMode=yes -o ConnectTimeout=2 -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=NUL -o LogLevel=ERROR root@127.0.0.1 \
        'systemctl poweroff' >/dev/null 2>&1 || true
    fi
    for _ in {1..15}; do
      kill -0 "$qemu_pid" 2>/dev/null || break
      sleep 1
    done
  fi
  [[ ! -f "$pid_file" ]] || windows_pid="$(tr -cd '0-9' < "$pid_file")"
  if [[ -n "$qemu_pid" ]] && kill -0 "$qemu_pid" 2>/dev/null && \
     [[ -n "$windows_pid" && -x "$windows_powershell" && -f "$stop_helper" ]]; then
    overlay_windows="$(wslpath -w "$overlay")"
    helper_windows="$(wslpath -w "$stop_helper")"
    "$windows_powershell" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass \
      -File "$helper_windows" -ExpectedPid "$windows_pid" -ExpectedOverlay "$overlay_windows" \
      >/dev/null 2>&1 || true
    for _ in {1..10}; do
      kill -0 "$qemu_pid" 2>/dev/null || break
      sleep 1
    done
  fi
  if [[ -n "$qemu_pid" ]] && kill -0 "$qemu_pid" 2>/dev/null; then
    stopped=0
    echo "Refused to clean VM artifacts because the owned QEMU process could not be stopped safely." >&2
  else
    [[ -z "$qemu_pid" ]] || wait "$qemu_pid" 2>/dev/null || true
    rm -f "$pid_file"
    if [[ "$overlay" == "$project_root/out/orca-vm-smoke."*".qcow2" ]]; then
      rm -f "$overlay" "$overlay.base.sha256"
    fi
  fi
  (( stopped == 1 )) || status=1
  exit "$status"
}
trap cleanup EXIT INT TERM

[[ -f "$image" ]] || { echo "Image not found: $image" >&2; exit 1; }
[[ -f "$ssh_key" ]] || { echo "VM SSH key not found: $ssh_key. Run 'make image'." >&2; exit 1; }

windows_curl="/mnt/c/Windows/System32/curl.exe"
windows_ssh="/mnt/c/Windows/System32/OpenSSH/ssh.exe"
windows_powershell="/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
[[ -x "$windows_curl" ]] || { echo "Windows curl.exe was not found." >&2; exit 1; }
[[ -x "$windows_ssh" ]] || { echo "Windows OpenSSH client was not found." >&2; exit 1; }
[[ -x "$windows_powershell" ]] || { echo "Windows PowerShell was not found." >&2; exit 1; }
[[ -f "$stop_helper" ]] || { echo "Validated QEMU stop helper was not found: $stop_helper" >&2; exit 1; }

mkdir -p "$(dirname "$log_file")"
: > "$log_file"
rm -f "$pid_file"

ORCA_IMAGE="$image" \
ORCA_VM_HEADLESS=1 \
ORCA_VM_SERIAL="file:$log_file" \
ORCA_VM_SSH_PORT="$ssh_port" \
ORCA_VM_API_PORT="$api_port" \
ORCA_VM_PID_FILE="$pid_file" \
ORCA_VM_OVERLAY="$overlay" \
ORCA_OVMF_VARS_COPY="$vars_copy" \
  "$project_root/vm/run-windows.sh" &
qemu_pid=$!

ssh_key_windows="$("$project_root/vm/prepare-windows-ssh-key.sh" "$ssh_key")"

ssh_guest() {
  "$windows_ssh" -T -i "$ssh_key_windows" -p "$ssh_port" \
    -o BatchMode=yes -o ConnectTimeout=3 -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=NUL -o LogLevel=ERROR root@127.0.0.1 "$@"
}

authenticated_api_get() {
  local token="$1" path="$2"
  printf 'header = "Authorization: Bearer %s"\nfail\nsilent\nshow-error\nmax-time = 2\n' "$token" | \
    "$windows_curl" --config - --url "http://127.0.0.1:${api_port}${path}" 2>/dev/null | tr -d '\r'
}

deadline=$((SECONDS + boot_timeout))
ready_seen=0
while (( SECONDS < deadline )); do
  if grep -q 'ORCA_OS_READY' "$log_file"; then
    ready_seen=1
    api_payload="$($windows_curl -fsS --max-time 2 "http://127.0.0.1:${api_port}/healthz" 2>/dev/null | tr -d '\r' || true)"
    unauthorized_status="$($windows_curl -sS -o NUL -w '%{http_code}' --max-time 2 "http://127.0.0.1:${api_port}/v1/status" 2>/dev/null | tr -d '\r' || true)"
    api_token="$(ssh_guest 'orca api token' 2>/dev/null | tr -d '\r\n' || true)"
    hardware_payload=""
    health_payload=""
    platform_payload=""
    nodes_payload=""
    if [[ "$api_token" =~ ^[0-9a-f]{64}$ ]]; then
      hardware_payload="$(authenticated_api_get "$api_token" /v1/hardware || true)"
      health_payload="$(authenticated_api_get "$api_token" /v1/health || true)"
      platform_payload="$(authenticated_api_get "$api_token" /v1/platform || true)"
      nodes_payload="$(authenticated_api_get "$api_token" /v1/nodes || true)"
    fi
    if [[ "$api_payload" == '{"status":"ok"}' ]] && \
      [[ "$unauthorized_status" == 401 ]] && \
      [[ "$api_token" =~ ^[0-9a-f]{64}$ ]] && \
      [[ "$hardware_payload" == *'"resources"'* ]] && \
      [[ "$health_payload" == *'"agent":"active"'* ]] && \
      [[ "$platform_payload" == *'"boardModel"'* ]] && \
      [[ "$nodes_payload" == *'"role":"local"'* ]] && \
      ssh_guest \
        'systemctl is-active --quiet systemd-networkd ssh orca-agent orca-api && ip -4 -o addr show scope global | grep -q '"'"' inet '"'"' && orca hardware --json | grep -q '"'"'"resources"'"'"' && orca platform --json | grep -q '"'"'"boardModel"'"'"' && orca health --json | grep -q '"'"'"agent":"active"'"'"' && orca nodes --json | grep -q '"'"'"role":"local"'"'"' && orca services --json | grep -q '"'"'"name":"orca-api","state":"active"'"'"' && orca network --json | grep -q '"'"'"ipv4"'"'"' && orca resources --json | grep -q '"'"'"processCount"'"'"' && orca logs orca-api 5 >/dev/null && bundle=/tmp/orca-smoke-support.tar.gz && test ! -e "$bundle" && orca support "$bundle" >/dev/null && test -s "$bundle" && tar -tzf "$bundle" | grep -q '"'"'resources.txt'"'"' && token=$(orca api token) && ! tar -xOzf "$bundle" 2>/dev/null | grep -Fq "$token" && rm -f "$bundle" && orca service orca-api restart >/dev/null && sleep 1 && orca doctor --json | grep -q '"'"'"status":"ok"'"'"'' \
        > "$project_root/out/orca-vm-ssh-check.log" 2>&1; then
      echo "Orca OS VM smoke test passed: boot, DHCP, SSH, authenticated API, resources, secret-safe support bundle, services, restart recovery, and diagnostics are healthy."
      cat "$project_root/out/orca-vm-ssh-check.log"
      exit 0
    fi
  fi
  if ! kill -0 "$qemu_pid" 2>/dev/null; then
    wait "$qemu_pid" || true
    echo "Windows QEMU exited before the Orca OS smoke test passed." >&2
    tail -n 100 "$log_file" >&2
    exit 1
  fi
  sleep 1
done

if (( ready_seen == 0 )); then
  echo "Timed out waiting for ORCA_OS_READY after ${boot_timeout}s." >&2
else
  echo "Orca OS booted, but DHCP, SSH, or the API did not become healthy within ${boot_timeout}s." >&2
fi
tail -n 120 "$log_file" >&2
[[ ! -f "$project_root/out/orca-vm-ssh-check.log" ]] || cat "$project_root/out/orca-vm-ssh-check.log" >&2
exit 1
