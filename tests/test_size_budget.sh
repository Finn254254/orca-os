#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_root="$(mktemp -d)"
trap 'rm -rf "$temp_root"' EXIT
printf '1234567890' > "$temp_root/image.raw"
printf '12345' > "$temp_root/initrd"
printf '1234567' > "$temp_root/image.efi"

ORCA_MAX_IMAGE_BYTES=10 ORCA_MAX_INITRD_BYTES=5 ORCA_MAX_EFI_BYTES=7 \
  "$project_root/build/check-size-budget.sh" \
  "$temp_root/image.raw" "$temp_root/initrd" "$temp_root/image.efi" "$temp_root/report.json" >/dev/null
python3 - "$temp_root/report.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["schemaVersion"] == 1
assert payload["status"] == "pass"
assert payload["artifacts"]["diskImage"]["sizeBytes"] == 10
assert payload["artifacts"]["diskImage"]["withinBudget"] is True
PY

if ORCA_MAX_IMAGE_BYTES=9 ORCA_MAX_INITRD_BYTES=5 ORCA_MAX_EFI_BYTES=7 \
  "$project_root/build/check-size-budget.sh" \
  "$temp_root/image.raw" "$temp_root/initrd" "$temp_root/image.efi" "$temp_root/failed.json" >/dev/null 2>&1; then
  echo 'size budget accepted an oversized image' >&2
  exit 1
fi
grep -q '"status": "fail"' "$temp_root/failed.json"
ln -s "$temp_root/image.raw" "$temp_root/image-link.raw"
if "$project_root/build/check-size-budget.sh" "$temp_root/image-link.raw" "$temp_root/initrd" "$temp_root/image.efi" >/dev/null 2>&1; then
  echo 'size budget accepted a symlinked artifact' >&2
  exit 1
fi
echo 'Artifact size-budget tests passed.'
