#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_root="$(mktemp -d)"
trap 'rm -rf "$temp_root"' EXIT

mkdir -p "$temp_root/etc" "$temp_root/run/orca"
cp "$project_root/config/etc/orca-release" "$temp_root/etc/orca-release"

info="$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" info)"
grep -q 'Name: Orca OS 0.1.0 (Tidepool)' <<<"$info"
grep -q 'Architecture:' <<<"$info"
grep -q 'CPU:' <<<"$info"
grep -q 'Memory MiB:' <<<"$info"

status="$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" status)"
grep -q 'Agent: inactive' <<<"$status"

printf 'Agent: active\nNode ID: test-node\n' > "$temp_root/run/orca/agent.status"
status="$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" status)"
grep -q 'Node ID: test-node' <<<"$status"

[[ "$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" version)" == "0.1.0" ]]

if ORCA_ROOT="$temp_root" "$project_root/cli/orca" unknown >/dev/null 2>&1; then
  echo 'unknown command unexpectedly succeeded' >&2
  exit 1
fi
