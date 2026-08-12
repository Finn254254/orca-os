#!/usr/bin/env bash
set -euo pipefail

rootfs="${1:?Usage: $0 ROOTFS}"

required_files=(
  /etc/orca-release
  /usr/local/bin/orca
  /usr/lib/orca/orca-agent
  /usr/lib/orca/orca-api.py
  /usr/lib/systemd/system/orca-agent.service
  /usr/lib/systemd/system/orca-api.service
  /usr/lib/systemd/system/orca-ready.service
  /etc/systemd/system/serial-getty@ttyS0.service.d/orca-autologin.conf
)

for file in "${required_files[@]}"; do
  [[ -e "$rootfs$file" ]] || { echo "Missing rootfs file: $file" >&2; exit 1; }
done

[[ -x "$rootfs/usr/local/bin/orca" ]] || { echo "orca CLI is not executable." >&2; exit 1; }
[[ -x "$rootfs/usr/lib/orca/orca-agent" ]] || { echo "orca agent is not executable." >&2; exit 1; }
[[ -x "$rootfs/usr/lib/orca/orca-api.py" ]] || { echo "orca API is not executable." >&2; exit 1; }

for unit in orca-agent orca-api orca-ready; do
  enabled="$rootfs/etc/systemd/system/multi-user.target.wants/$unit.service"
  [[ -L "$enabled" ]] || { echo "Unit is not enabled: $unit" >&2; exit 1; }
  [[ "$(readlink "$enabled")" == "/usr/lib/systemd/system/$unit.service" ]] || {
    echo "Unit has an unexpected target: $unit" >&2; exit 1;
  }
done

grep -q 'ORCA_OS_READY' "$rootfs/usr/lib/systemd/system/orca-ready.service" || {
  echo "Boot readiness marker is not configured." >&2
  exit 1
}

serial_override="$rootfs/etc/systemd/system/serial-getty@ttyS0.service.d/orca-autologin.conf"
grep -q -- '--autologin root' "$serial_override" || {
  echo "Serial console autologin is not configured." >&2
  exit 1
}

echo "Rootfs verification passed."
