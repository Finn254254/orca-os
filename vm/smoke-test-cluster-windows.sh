#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
run_windows="${ORCA_RUN_WINDOWS:-$project_root/vm/run-windows.sh}"
prepare_key="${ORCA_PREPARE_WINDOWS_KEY:-$project_root/vm/prepare-windows-ssh-key.sh}"
image="${ORCA_IMAGE:-$project_root/out/orca-os-x86_64.raw}"
ssh_key="${ORCA_VM_SSH_KEY:-$project_root/out/orca-vm.id_ed25519}"
output_dir="$(realpath -m -- "${ORCA_CLUSTER_OUTPUT_DIR:-$project_root/out}")"
memory="${ORCA_CLUSTER_MEMORY:-1536}"
cpus="${ORCA_CLUSTER_CPUS:-2}"
boot_timeout="${ORCA_CLUSTER_BOOT_TIMEOUT:-180}"
shutdown_timeout="${ORCA_CLUSTER_SHUTDOWN_TIMEOUT:-20}"
ssh_port1="${ORCA_CLUSTER_SSH_PORT_1:-2322}"
ssh_port2="${ORCA_CLUSTER_SSH_PORT_2:-2323}"
api_port1="${ORCA_CLUSTER_API_PORT_1:-9976}"
api_port2="${ORCA_CLUSTER_API_PORT_2:-9977}"
mac1="${ORCA_CLUSTER_MAC_1:-02:4f:52:43:41:01}"
mac2="${ORCA_CLUSTER_MAC_2:-02:4f:52:43:41:02}"
mode="run"

case "${1:-}" in
  "") ;;
  --plan|--dry-run) mode="plan" ;;
  --preflight) mode="preflight" ;;
  -h|--help)
    cat <<'EOF'
Usage: smoke-test-cluster-windows.sh [--plan|--dry-run|--preflight]

Launch two disposable Orca OS nodes with Windows QEMU/WHPX and prove secure,
bidirectional peer reachability. --plan and --dry-run are side-effect free;
--preflight validates the Windows QEMU launch plans without starting VMs.
EOF
    exit 0
    ;;
  *) echo "Unknown argument: $1" >&2; exit 2 ;;
esac

if [[ "$mode" == plan ]]; then
  run_id="${ORCA_CLUSTER_RUN_ID:-plan}"
else
  run_id="${ORCA_CLUSTER_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
fi

fail() {
  echo "$*" >&2
  exit 1
}

valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535))
}

valid_local_unicast_mac() {
  local mac="$1" first
  [[ "$mac" =~ ^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$ ]] || return 1
  first="${mac%%:*}"
  first=$((16#$first))
  (( (first & 1) == 0 && (first & 2) == 2 ))
}

[[ "$run_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || fail "Invalid cluster run ID."
[[ "$memory" =~ ^[0-9]+$ ]] && ((memory >= 128 && memory <= 65536)) || fail "Cluster memory must be between 128 and 65536 MiB."
[[ "$cpus" =~ ^[0-9]+$ ]] && ((cpus >= 1 && cpus <= 64)) || fail "Cluster CPUs must be between 1 and 64."
[[ "$boot_timeout" =~ ^[0-9]+$ ]] && ((boot_timeout >= 1 && boot_timeout <= 1800)) || fail "Invalid boot timeout."
[[ "$shutdown_timeout" =~ ^[0-9]+$ ]] && ((shutdown_timeout >= 1 && shutdown_timeout <= 300)) || fail "Invalid shutdown timeout."

declare -A used_ports=()
for port in "$ssh_port1" "$ssh_port2" "$api_port1" "$api_port2"; do
  valid_port "$port" || fail "Invalid cluster port: $port"
  [[ -z "${used_ports[$port]:-}" ]] || fail "Cluster ports must be unique: $port"
  used_ports[$port]=1
done
valid_local_unicast_mac "$mac1" || fail "Node 1 MAC must be a locally administered unicast address."
valid_local_unicast_mac "$mac2" || fail "Node 2 MAC must be a locally administered unicast address."
[[ "${mac1,,}" != "${mac2,,}" ]] || fail "Cluster node MAC addresses must differ."

[[ -n "$output_dir" && "$output_dir" != / ]] || fail "Unsafe cluster output directory."
session_dir="$output_dir/orca-cluster-smoke-$run_id"
overlay1="$session_dir/node1.qcow2"
overlay2="$session_dir/node2.qcow2"
vars1="$session_dir/node1-vars.fd"
vars2="$session_dir/node2-vars.fd"
log1="$session_dir/node1-serial.log"
log2="$session_dir/node2-serial.log"
launcher_log1="$session_dir/node1-launcher.log"
launcher_log2="$session_dir/node2-launcher.log"
pid_file1="$session_dir/node1.pid"
pid_file2="$session_dir/node2.pid"
kill_script="$session_dir/validated-qemu-stop.ps1"
endpoint_from_node1="10.0.2.2:$api_port2"
endpoint_from_node2="10.0.2.2:$api_port1"

print_plan() {
  printf 'cluster run_id=%s memory_mib=%s cpus=%s\n' "$run_id" "$memory" "$cpus"
  printf 'node=1 ssh_port=%s api_port=%s mac=%s overlay=%s vars=%s log=%s pid=%s peer_endpoint=%s\n' \
    "$ssh_port1" "$api_port1" "$mac1" "$overlay1" "$vars1" "$log1" "$pid_file1" "$endpoint_from_node1"
  printf 'node=2 ssh_port=%s api_port=%s mac=%s overlay=%s vars=%s log=%s pid=%s peer_endpoint=%s\n' \
    "$ssh_port2" "$api_port2" "$mac2" "$overlay2" "$vars2" "$log2" "$pid_file2" "$endpoint_from_node2"
}

if [[ "$mode" == plan ]]; then
  print_plan
  exit 0
fi

[[ ! -e "$session_dir" ]] || fail "Cluster session already exists: $session_dir"
mkdir -p "$output_dir"
mkdir "$session_dir"

windows_curl="${ORCA_WINDOWS_CURL:-/mnt/c/Windows/System32/curl.exe}"
windows_ssh="${ORCA_WINDOWS_SSH:-/mnt/c/Windows/System32/OpenSSH/ssh.exe}"
windows_powershell="${ORCA_WINDOWS_POWERSHELL:-/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe}"
python_cmd="${ORCA_PYTHON_CMD:-python3}"
ssh_key_windows=""
launcher_pid1=""
launcher_pid2=""
node1_ready=0
node2_ready=0

write_kill_script() {
  cat > "$kill_script" <<'POWERSHELL'
param(
    [Parameter(Mandatory = $true)][int]$ExpectedPid,
    [Parameter(Mandatory = $true)][string]$ExpectedOverlay
)
$ErrorActionPreference = "Stop"
$process = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $ExpectedPid)
if ($null -eq $process) {
    exit 0
}
$executableName = [IO.Path]::GetFileName($process.ExecutablePath)
if ($executableName -ine "qemu-system-x86_64.exe") {
    Write-Error "PID $ExpectedPid is not qemu-system-x86_64.exe"
    exit 20
}
if ([string]::IsNullOrWhiteSpace($process.CommandLine) -or
    $process.CommandLine.IndexOf($ExpectedOverlay, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    Write-Error "PID $ExpectedPid does not reference the expected disposable overlay"
    exit 21
}
$taskkill = Join-Path $env:SystemRoot "System32\taskkill.exe"
& $taskkill /PID $ExpectedPid /T /F | Out-Null
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
POWERSHELL
  chmod 600 "$kill_script"
}

preflight() {
  local qemu_plan
  [[ -f "$image" ]] || fail "Image not found: $image. Run 'make image' first."
  [[ -f "$ssh_key" ]] || fail "VM SSH key not found: $ssh_key. Run 'make image' first."
  [[ -x "$run_windows" ]] || fail "Windows VM launcher is not executable: $run_windows"
  [[ -x "$prepare_key" ]] || fail "Windows SSH-key helper is not executable: $prepare_key"
  [[ -x "$windows_curl" ]] || fail "Windows curl was not found: $windows_curl"
  [[ -x "$windows_ssh" ]] || fail "Windows OpenSSH was not found: $windows_ssh"
  [[ -x "$windows_powershell" ]] || fail "Windows PowerShell was not found: $windows_powershell"
  command -v "$python_cmd" >/dev/null || fail "Python is required to validate cluster responses."
  command -v wslpath >/dev/null || fail "This harness must run inside WSL."

  qemu_plan="$(
    ORCA_IMAGE="$image" ORCA_VM_MEMORY="$memory" ORCA_VM_CPUS="$cpus" \
    ORCA_VM_SSH_PORT="$ssh_port1" ORCA_VM_API_PORT="$api_port1" ORCA_VM_MAC="$mac1" \
    ORCA_VM_SERIAL="file:$log1" ORCA_VM_PID_FILE="$pid_file1" \
    ORCA_VM_OVERLAY="$overlay1" ORCA_OVMF_VARS_COPY="$vars1" \
      "$run_windows" --dry-run
  )"
  grep -Fq "mac=$mac1" <<<"$qemu_plan" || fail "run-windows.sh did not apply ORCA_VM_MAC for node 1."
  qemu_plan="$(
    ORCA_IMAGE="$image" ORCA_VM_MEMORY="$memory" ORCA_VM_CPUS="$cpus" \
    ORCA_VM_SSH_PORT="$ssh_port2" ORCA_VM_API_PORT="$api_port2" ORCA_VM_MAC="$mac2" \
    ORCA_VM_SERIAL="file:$log2" ORCA_VM_PID_FILE="$pid_file2" \
    ORCA_VM_OVERLAY="$overlay2" ORCA_OVMF_VARS_COPY="$vars2" \
      "$run_windows" --dry-run
  )"
  grep -Fq "mac=$mac2" <<<"$qemu_plan" || fail "run-windows.sh did not apply ORCA_VM_MAC for node 2."
}

launcher_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

wait_for_launcher_exit() {
  local pid="$1" deadline=$((SECONDS + shutdown_timeout))
  [[ -n "$pid" ]] || return 0
  while launcher_alive "$pid" && ((SECONDS < deadline)); do
    sleep 1
  done
  if ! launcher_alive "$pid"; then
    wait "$pid" 2>/dev/null || true
    return 0
  fi
  return 1
}

validated_taskkill() {
  local pid_file="$1" overlay="$2" pid overlay_windows
  [[ -f "$pid_file" && ! -L "$pid_file" ]] || return 1
  pid="$(tr -d '[:space:]' < "$pid_file")"
  [[ "$pid" =~ ^[0-9]+$ && "$pid" != 0 ]] || return 1
  overlay_windows="$(wslpath -w "$overlay")"
  "$windows_powershell" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass \
    -File "$(wslpath -w "$kill_script")" \
    -ExpectedPid "$pid" -ExpectedOverlay "$overlay_windows"
}

ssh_node() {
  local port="$1"
  shift
  "$windows_ssh" -T -i "$ssh_key_windows" -p "$port" \
    -o BatchMode=yes -o ConnectTimeout=3 -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=NUL -o LogLevel=ERROR root@127.0.0.1 "$@"
}

request_poweroff() {
  local port="$1"
  [[ -n "$ssh_key_windows" ]] || return 0
  ssh_node "$port" 'systemctl poweroff' >/dev/null 2>&1 || true
}

stop_node() {
  local launcher_pid="$1" port="$2" pid_file="$3" overlay="$4"
  launcher_alive "$launcher_pid" || { [[ -z "$launcher_pid" ]] || wait "$launcher_pid" 2>/dev/null || true; return 0; }
  request_poweroff "$port"
  wait_for_launcher_exit "$launcher_pid" && return 0
  if ! validated_taskkill "$pid_file" "$overlay"; then
    echo "Refused to force-stop node on port $port because its Windows QEMU identity could not be validated." >&2
    return 1
  fi
  wait_for_launcher_exit "$launcher_pid"
}

remove_session_files() {
  local preserve_logs="${1:-0}"
  local expected="$output_dir/orca-cluster-smoke-$run_id"
  [[ "$session_dir" == "$expected" && -d "$session_dir" ]] || return 1
  rm -f -- \
    "$overlay1" "$overlay1.base.sha256" "$overlay2" "$overlay2.base.sha256" \
    "$vars1" "$vars2" "$pid_file1" "$pid_file2" "$kill_script"
  if [[ "$preserve_logs" == 0 ]]; then
    rm -f -- "$log1" "$log2" "$launcher_log1" "$launcher_log2"
    rmdir -- "$session_dir"
  else
    echo "Cluster failure logs preserved: $session_dir" >&2
  fi
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  set +e
  stop_node "$launcher_pid1" "$ssh_port1" "$pid_file1" "$overlay1"
  stopped1=$?
  stop_node "$launcher_pid2" "$ssh_port2" "$pid_file2" "$overlay2"
  stopped2=$?
  if ((stopped1 == 0 && stopped2 == 0)); then
    preserve_logs=0
    ((status == 0)) || preserve_logs=1
    remove_session_files "$preserve_logs" || echo "Cluster session cleanup was incomplete: $session_dir" >&2
  else
    echo "Cluster artifacts were preserved because a VM may still be running: $session_dir" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

preflight
if [[ "$mode" == preflight ]]; then
  print_plan
  echo "Windows/WHPX cluster preflight passed."
  exit 0
fi

write_kill_script
ssh_key_windows="$($prepare_key "$ssh_key" | tr -d '\r')"
[[ -n "$ssh_key_windows" ]] || fail "Could not prepare the Windows SSH key."

ORCA_IMAGE="$image" ORCA_VM_MEMORY="$memory" ORCA_VM_CPUS="$cpus" \
ORCA_VM_HEADLESS=1 ORCA_VM_SSH_PORT="$ssh_port1" ORCA_VM_API_PORT="$api_port1" \
ORCA_VM_MAC="$mac1" ORCA_VM_SERIAL="file:$log1" ORCA_VM_PID_FILE="$pid_file1" \
ORCA_VM_OVERLAY="$overlay1" ORCA_OVMF_VARS_COPY="$vars1" \
  "$run_windows" >"$launcher_log1" 2>&1 &
launcher_pid1=$!

ORCA_IMAGE="$image" ORCA_VM_MEMORY="$memory" ORCA_VM_CPUS="$cpus" \
ORCA_VM_HEADLESS=1 ORCA_VM_SSH_PORT="$ssh_port2" ORCA_VM_API_PORT="$api_port2" \
ORCA_VM_MAC="$mac2" ORCA_VM_SERIAL="file:$log2" ORCA_VM_PID_FILE="$pid_file2" \
ORCA_VM_OVERLAY="$overlay2" ORCA_OVMF_VARS_COPY="$vars2" \
  "$run_windows" >"$launcher_log2" 2>&1 &
launcher_pid2=$!

wait_for_node() {
  local node="$1" launcher_pid="$2" ssh_port="$3" api_port="$4" log="$5"
  local deadline=$((SECONDS + boot_timeout)) health
  while ((SECONDS < deadline)); do
    if ! launcher_alive "$launcher_pid"; then
      echo "Node $node QEMU exited before readiness." >&2
      tail -n 80 "$log" >&2 || true
      return 1
    fi
    if grep -q 'ORCA_OS_READY' "$log" 2>/dev/null; then
      health="$($windows_curl -fsS --max-time 2 "http://127.0.0.1:$api_port/healthz" 2>/dev/null | tr -d '\r' || true)"
      if [[ "$health" == '{"status":"ok"}' ]] && ssh_node "$ssh_port" 'true' >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
  done
  echo "Timed out waiting for node $node on SSH $ssh_port and API $api_port." >&2
  tail -n 80 "$log" >&2 || true
  return 1
}

wait_for_node 1 "$launcher_pid1" "$ssh_port1" "$api_port1" "$log1"
node1_ready=1
wait_for_node 2 "$launcher_pid2" "$ssh_port2" "$api_port2" "$log2"
node2_ready=1
ssh_node "$ssh_port1" 'orca node rename orca-cluster-1' >/dev/null
ssh_node "$ssh_port2" 'orca node rename orca-cluster-2' >/dev/null

node_id1="$(ssh_node "$ssh_port1" 'orca node id' | tr -d '\r\n')"
node_id2="$(ssh_node "$ssh_port2" 'orca node id' | tr -d '\r\n')"
token1="$(ssh_node "$ssh_port1" 'orca api token' | tr -d '\r\n')"
token2="$(ssh_node "$ssh_port2" 'orca api token' | tr -d '\r\n')"
host_key1="$(ssh_node "$ssh_port1" 'cat /etc/ssh/ssh_host_ed25519_key.pub' | tr -d '\r\n')"
host_key2="$(ssh_node "$ssh_port2" 'cat /etc/ssh/ssh_host_ed25519_key.pub' | tr -d '\r\n')"
[[ "$node_id1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || fail "Node 1 returned an invalid node ID."
[[ "$node_id2" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || fail "Node 2 returned an invalid node ID."
[[ "$node_id1" != "$node_id2" ]] || fail "Disposable nodes unexpectedly share the same node ID."
[[ "$token1" =~ ^[0-9a-f]{64}$ ]] || fail "Node 1 returned an invalid API token."
[[ "$token2" =~ ^[0-9a-f]{64}$ ]] || fail "Node 2 returned an invalid API token."
[[ "$host_key1" == ssh-ed25519\ * ]] || fail "Node 1 returned an invalid SSH Ed25519 host key."
[[ "$host_key2" == ssh-ed25519\ * ]] || fail "Node 2 returned an invalid SSH Ed25519 host key."
[[ "$host_key1" != "$host_key2" ]] || fail "Disposable nodes unexpectedly share the same SSH host identity."

authenticated_api_get() {
  local port="$1" token="$2" path="$3"
  printf 'header = "Authorization: Bearer %s"\nfail\nsilent\nshow-error\nmax-time = 5\n' "$token" |
    "$windows_curl" --config - --url "http://127.0.0.1:$port$path" | tr -d '\r'
}

assert_node_payload() {
  local expected_id="$1" payload="$2"
  printf '%s' "$payload" | "$python_cmd" -c \
    'import json,sys; payload=json.load(sys.stdin); raise SystemExit(payload.get("nodeId") != sys.argv[1])' \
    "$expected_id"
}

assert_nodes_payload() {
  local local_id="$1" peer_id="$2" payload="$3"
  printf '%s' "$payload" | "$python_cmd" -c '
import json, sys
nodes = json.load(sys.stdin).get("nodes", [])
local_ok = any(node.get("nodeId") == sys.argv[1] and node.get("role") == "local" for node in nodes)
peer_ok = any(node.get("nodeId") == sys.argv[2] and node.get("role") == "peer" for node in nodes)
raise SystemExit(not (local_ok and peer_ok))
' "$local_id" "$peer_id"
}

node_payload1="$(authenticated_api_get "$api_port1" "$token1" /v1/node)"
node_payload2="$(authenticated_api_get "$api_port2" "$token2" /v1/node)"
assert_node_payload "$node_id1" "$node_payload1"
assert_node_payload "$node_id2" "$node_payload2"

printf '%s\n' "$token2" | ssh_node "$ssh_port1" \
  "orca peer add $node_id2 $endpoint_from_node1 --token-stdin" >/dev/null
printf '%s\n' "$token1" | ssh_node "$ssh_port2" \
  "orca peer add $node_id1 $endpoint_from_node2 --token-stdin" >/dev/null

ssh_node "$ssh_port1" "orca peer check $node_id2" >/dev/null
ssh_node "$ssh_port2" "orca peer check $node_id1" >/dev/null
nodes_payload1="$(ssh_node "$ssh_port1" 'orca nodes --json' | tr -d '\r')"
nodes_payload2="$(ssh_node "$ssh_port2" 'orca nodes --json' | tr -d '\r')"
assert_nodes_payload "$node_id1" "$node_id2" "$nodes_payload1"
assert_nodes_payload "$node_id2" "$node_id1" "$nodes_payload2"

request_poweroff "$ssh_port1"
request_poweroff "$ssh_port2"
graceful1=0
graceful2=0
wait_for_launcher_exit "$launcher_pid1" && graceful1=1
wait_for_launcher_exit "$launcher_pid2" && graceful2=1
((graceful1 == 1 && graceful2 == 1)) || fail "One or more cluster nodes did not power off gracefully."
remove_session_files
trap - EXIT INT TERM
echo "Orca OS two-node Windows/WHPX smoke test passed: unique identities, authenticated APIs, secure enrollment, and bidirectional peer reachability."
