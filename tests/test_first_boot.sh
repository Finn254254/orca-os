#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_root="$(mktemp -d)"
trap 'rm -rf "$temp_root"' EXIT

marker="$temp_root/state/first-boot-complete"
token="$temp_root/state/api-token"
ORCA_FIRST_BOOT_MARKER="$marker" \
ORCA_API_TOKEN_FILE="$token" \
ORCA_TOKEN_INIT="$project_root/services/orca-token-init" \
  "$project_root/services/orca-first-boot"

[[ -s "$marker" ]]
[[ -s "$token" ]]
token_value="$(cat "$token")"
grep -Eq '^completed=[0-9]{4}-[0-9]{2}-[0-9]{2}T' "$marker"

ORCA_FIRST_BOOT_MARKER="$marker" \
ORCA_API_TOKEN_FILE="$token" \
ORCA_TOKEN_INIT="$project_root/services/orca-token-init" \
  "$project_root/services/orca-first-boot"
[[ "$(cat "$token")" == "$token_value" ]]

echo 'first-boot initialization tests passed.'
