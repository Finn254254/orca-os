#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_root="$(mktemp -d)"
trap 'rm -rf "$temp_root"' EXIT

mkdir -p "$temp_root/etc" "$temp_root/run/orca" "$temp_root/var/lib/orca"
cp "$project_root/config/etc/orca-release" "$temp_root/etc/orca-release"

info="$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" info)"
grep -q 'Name: Orca OS 0.1.0 (Tidepool)' <<<"$info"
grep -q 'Architecture:' <<<"$info"
grep -q 'CPU:' <<<"$info"
grep -q 'Memory MiB:' <<<"$info"

status="$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" status)"
grep -q 'Agent: inactive' <<<"$status"

printf 'Agent: active\nNode ID: test-node\n' > "$temp_root/run/orca/agent.status"
printf 'test-node\n' > "$temp_root/var/lib/orca/node-id"
printf '{"nodeId":"test-node","agent":"active"}\n' > "$temp_root/run/orca/node.json"
status="$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" status)"
grep -q 'Node ID: test-node' <<<"$status"
grep -q '"nodeId":"test-node"' <<<"$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" status --json)"
[[ "$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" node id)" == "test-node" ]]
grep -q '"agent":"active"' <<<"$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" node show)"

[[ "$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" version)" == "0.1.0" ]]

if ORCA_ROOT="$temp_root" "$project_root/cli/orca" unknown >/dev/null 2>&1; then
  echo 'unknown command unexpectedly succeeded' >&2
  exit 1
fi
