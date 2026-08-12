#!/usr/bin/env bash
set -euo pipefail

if (( $# < 3 || $# > 4 )); then
  echo "Usage: $0 IMAGE.raw INITRD EFI [REPORT.json]" >&2
  exit 2
fi

image="$1"
initrd="$2"
efi="$3"
report="${4:-}"
image_max="${ORCA_MAX_IMAGE_BYTES:-1650000000}"
initrd_max="${ORCA_MAX_INITRD_BYTES:-140000000}"
efi_max="${ORCA_MAX_EFI_BYTES:-150000000}"

for limit in "$image_max" "$initrd_max" "$efi_max"; do
  [[ "$limit" =~ ^[0-9]+$ ]] && ((limit > 0)) || {
    echo "Artifact budget limits must be positive byte counts." >&2
    exit 2
  }
done

for artifact in "$image" "$initrd" "$efi"; do
  [[ -f "$artifact" && ! -L "$artifact" ]] || {
    echo "Artifact is missing, not regular, or a symlink: $artifact" >&2
    exit 1
  }
done

image_size="$(stat -c '%s' -- "$image")"
initrd_size="$(stat -c '%s' -- "$initrd")"
efi_size="$(stat -c '%s' -- "$efi")"
status=pass
((image_size <= image_max && initrd_size <= initrd_max && efi_size <= efi_max)) || status=fail

render_report() {
  ORCA_BUDGET_STATUS="$status" \
  ORCA_BUDGET_IMAGE_PATH="$(basename "$image")" ORCA_BUDGET_IMAGE_SIZE="$image_size" ORCA_BUDGET_IMAGE_MAX="$image_max" \
  ORCA_BUDGET_INITRD_PATH="$(basename "$initrd")" ORCA_BUDGET_INITRD_SIZE="$initrd_size" ORCA_BUDGET_INITRD_MAX="$initrd_max" \
  ORCA_BUDGET_EFI_PATH="$(basename "$efi")" ORCA_BUDGET_EFI_SIZE="$efi_size" ORCA_BUDGET_EFI_MAX="$efi_max" \
    python3 - <<'PY'
import json
import os

def artifact(prefix):
    size = int(os.environ[f"ORCA_BUDGET_{prefix}_SIZE"])
    maximum = int(os.environ[f"ORCA_BUDGET_{prefix}_MAX"])
    return {
        "filename": os.environ[f"ORCA_BUDGET_{prefix}_PATH"],
        "sizeBytes": size,
        "maxBytes": maximum,
        "withinBudget": size <= maximum,
    }

print(json.dumps({
    "schemaVersion": 1,
    "profile": "x86_64-development-vm",
    "status": os.environ["ORCA_BUDGET_STATUS"],
    "artifacts": {
        "diskImage": artifact("IMAGE"),
        "initrd": artifact("INITRD"),
        "efi": artifact("EFI"),
    },
}, indent=2, sort_keys=True))
PY
}

if [[ -n "$report" ]]; then
  report_dir="$(dirname -- "$report")"
  [[ -d "$report_dir" ]] || { echo "Report directory does not exist: $report_dir" >&2; exit 1; }
  [[ ! -L "$report" ]] || { echo "Refusing to replace a symlinked report: $report" >&2; exit 1; }
  temporary="$report.tmp.$$"
  trap 'rm -f -- "$temporary"' EXIT
  render_report > "$temporary"
  chmod 644 "$temporary"
  mv -f -- "$temporary" "$report"
  trap - EXIT
  echo "Wrote $report"
else
  render_report
fi

if [[ "$status" != pass ]]; then
  echo "Orca development image exceeded its artifact size budget." >&2
  exit 1
fi
