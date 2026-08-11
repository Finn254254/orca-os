#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="$($project_root/build/build-image.sh --dry-run)"
grep -q 'mkosi build definition' <<<"$output"
grep -q 'Architecture=x86_64' "$project_root/build/mkosi.conf"
grep -q 'Format=disk' "$project_root/build/mkosi.conf"
