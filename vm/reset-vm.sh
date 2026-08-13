#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
overlay="$project_root/out/orca-vm.qcow2"
marker="$overlay.base.sha256"

[[ "$overlay" == "$project_root/out/orca-vm.qcow2" ]] || {
  echo "Refusing to reset an unexpected path: $overlay" >&2
  exit 1
}

if [[ ! -e "$overlay" && ! -e "$marker" ]]; then
  echo "No persistent VM overlay exists."
  exit 0
fi

rm -f "$overlay" "$marker"
echo "Reset the persistent VM overlay. The verified base image was not changed."
