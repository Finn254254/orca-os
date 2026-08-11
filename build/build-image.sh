#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="${ORCA_OUTPUT_DIR:-$project_root/out}"
stage_dir="${ORCA_STAGE_DIR:-$output_dir/stage-rootfs}"
source_date_epoch="${SOURCE_DATE_EPOCH:-0}"

if [[ "${1:-}" == "--dry-run" ]]; then
  printf 'mkosi build definition: %s\n' "$project_root/build/mkosi.conf"
  printf 'rootfs installer: %s\n' "$project_root/tools/install-rootfs.sh"
  exit 0
fi

command -v mkosi >/dev/null || {
  echo "mkosi is required. Install it from your Linux distribution or https://github.com/systemd/mkosi." >&2
  exit 1
}

rm -rf "$stage_dir"
mkdir -p "$stage_dir"
"$project_root/tools/install-rootfs.sh" "$stage_dir"

mkdir -p "$output_dir"
SOURCE_DATE_EPOCH="$source_date_epoch" mkosi -C "$project_root/build" -f build \
  --output-directory="$output_dir" \
  --extra-tree="$stage_dir"

echo "Built $output_dir/orca-os-x86_64.raw"
