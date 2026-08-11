#!/usr/bin/env bash
set -euo pipefail

image="${1:?Usage: $0 IMAGE.raw}"

if [[ "${2:-}" == "--dry-run" ]]; then
  printf 'would verify GPT and EFI partition in %s\n' "$image"
  exit 0
fi

[[ -f "$image" ]] || { echo "Image not found: $image" >&2; exit 1; }
command -v fdisk >/dev/null || { echo "fdisk is required to inspect the image." >&2; exit 1; }

partition_table="$(fdisk -l "$image")"
grep -q 'Disklabel type: gpt' <<<"$partition_table" || { echo "Expected a GPT disk image." >&2; exit 1; }
grep -q 'EFI System' <<<"$partition_table" || { echo "Expected an EFI System Partition." >&2; exit 1; }

sha256sum "$image" > "$image.sha256"
echo "Verified $image and wrote $image.sha256"
