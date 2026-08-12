#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$project_root/vm/smoke-test-cluster-windows.sh"
temp_root="$(mktemp -d)"
cleanup() {
  [[ -n "${temp_root:-}" && -d "$temp_root" ]] || return 0
  rm -rf -- "${temp_root:?}"
}
trap cleanup EXIT

mkdir -p "$temp_root/bin" "$temp_root/output"
cat > "$temp_root/bin/run-windows" <<EOF
#!/usr/bin/env bash
printf launched > "$temp_root/launched"
exit 99
EOF
chmod +x "$temp_root/bin/run-windows"

plan="$({
  ORCA_CLUSTER_OUTPUT_DIR="$temp_root/output" \
  ORCA_CLUSTER_RUN_ID=fixture \
  ORCA_RUN_WINDOWS="$temp_root/bin/run-windows" \
    "$script" --plan
})"
dry_run="$({
  ORCA_CLUSTER_OUTPUT_DIR="$temp_root/output" \
  ORCA_CLUSTER_RUN_ID=fixture \
  ORCA_RUN_WINDOWS="$temp_root/bin/run-windows" \
    "$script" --dry-run
})"

[[ "$plan" == "$dry_run" ]] || { echo "--plan and --dry-run differ" >&2; exit 1; }
[[ ! -e "$temp_root/launched" ]] || { echo "plan mode launched QEMU" >&2; exit 1; }
grep -q '^cluster run_id=fixture memory_mib=1536 cpus=2$' <<<"$plan"
grep -q 'node=1 ssh_port=2322 api_port=9976 mac=02:4f:52:43:41:01' <<<"$plan"
grep -q 'node=2 ssh_port=2323 api_port=9977 mac=02:4f:52:43:41:02' <<<"$plan"
grep -q 'peer_endpoint=10.0.2.2:9977' <<<"$plan"
grep -q 'peer_endpoint=10.0.2.2:9976' <<<"$plan"
[[ "$(grep -c '^node=' <<<"$plan")" == 2 ]]

if ORCA_CLUSTER_OUTPUT_DIR="$temp_root/output" ORCA_CLUSTER_RUN_ID=fixture \
  ORCA_CLUSTER_API_PORT_2=2322 "$script" --plan >/dev/null 2>&1; then
  echo "duplicate ports were accepted" >&2
  exit 1
fi
if ORCA_CLUSTER_OUTPUT_DIR="$temp_root/output" ORCA_CLUSTER_RUN_ID=fixture \
  ORCA_CLUSTER_MAC_1=00:4f:52:43:41:01 "$script" --plan >/dev/null 2>&1; then
  echo "a globally administered MAC was accepted" >&2
  exit 1
fi
if ORCA_CLUSTER_OUTPUT_DIR="$temp_root/output" ORCA_CLUSTER_RUN_ID=fixture \
  ORCA_CLUSTER_MAC_2=02:4f:52:43:41:01 "$script" --plan >/dev/null 2>&1; then
  echo "duplicate MAC addresses were accepted" >&2
  exit 1
fi
if ORCA_CLUSTER_OUTPUT_DIR="$temp_root/output" ORCA_CLUSTER_RUN_ID=../escape \
  "$script" --plan >/dev/null 2>&1; then
  echo "an unsafe run ID was accepted" >&2
  exit 1
fi

grep -q 'ORCA_VM_MAC="$mac1"' "$script"
grep -q 'ORCA_VM_MAC="$mac2"' "$script"
grep -q -- '--token-stdin' "$script"
grep -q 'ssh_host_ed25519_key.pub' "$script"
grep -q 'share the same SSH host identity' "$script"
grep -q 'Get-CimInstance Win32_Process' "$script"
grep -q 'process.ExecutablePath' "$script"
grep -q 'process.CommandLine' "$script"
grep -q 'taskkill.exe' "$script"
grep -q 'rmdir -- "$session_dir"' "$script"
grep -q 'Cluster failure logs preserved' "$script"

echo "Windows cluster smoke harness tests passed"
