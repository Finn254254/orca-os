#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${1:?Usage: $0 IMAGE.raw [MANIFEST.json]}"
manifest="${2:-$image.manifest.json}"
source_date_epoch="${SOURCE_DATE_EPOCH:-0}"
release_file="$project_root/config/etc/orca-release"

[[ -f "$image" ]] || { echo "Image not found: $image" >&2; exit 1; }
[[ "$source_date_epoch" =~ ^[0-9]+$ ]] || { echo "SOURCE_DATE_EPOCH must be a non-negative integer." >&2; exit 2; }

read_release_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { value=substr($0, length(key) + 2); gsub(/^"|"$/, "", value); print value; exit }' "$release_file"
}

image_sha256="$(sha256sum "$image" | awk '{print $1}')"
ORCA_MANIFEST_IMAGE="$(basename "$image")" \
ORCA_MANIFEST_SHA256="$image_sha256" \
ORCA_MANIFEST_SIZE="$(stat -c '%s' -- "$image")" \
ORCA_MANIFEST_NAME="$(read_release_value PRETTY_NAME)" \
ORCA_MANIFEST_VERSION="$(read_release_value VERSION)" \
ORCA_MANIFEST_ARCHITECTURE="x86_64" \
ORCA_MANIFEST_EPOCH="$source_date_epoch" \
  python3 - "$manifest" <<'PY'
import datetime
import json
import os
import sys

epoch = int(os.environ["ORCA_MANIFEST_EPOCH"])
payload = {
    "schemaVersion": 1,
    "name": os.environ["ORCA_MANIFEST_NAME"],
    "version": os.environ["ORCA_MANIFEST_VERSION"],
    "architecture": os.environ["ORCA_MANIFEST_ARCHITECTURE"],
    "artifact": {
        "filename": os.environ["ORCA_MANIFEST_IMAGE"],
        "sha256": os.environ["ORCA_MANIFEST_SHA256"],
        "sizeBytes": int(os.environ["ORCA_MANIFEST_SIZE"]),
    },
    "profile": "x86_64-development-vm",
    "sourceDateEpoch": epoch,
    "buildTimestamp": datetime.datetime.fromtimestamp(
        epoch, tz=datetime.timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
with open(sys.argv[1], "w", encoding="utf-8") as output:
    json.dump(payload, output, indent=2, sort_keys=True)
    output.write("\n")
PY

echo "Wrote $manifest"
