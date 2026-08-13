#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then
  exec "$project_root/vm/run-windows.sh" "$@"
fi

exec "$project_root/vm/run-qemu.sh" "$@"
