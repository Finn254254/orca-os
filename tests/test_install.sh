#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rootfs="$(mktemp -d)"
trap 'rm -rf "$rootfs"' EXIT

"$project_root/tools/install-rootfs.sh" "$rootfs"
"$project_root/tools/verify-rootfs.sh" "$rootfs"
if sed 's/--autologin root/--login-options/' "$rootfs/etc/systemd/system/serial-getty@ttyS0.service.d/orca-autologin.conf" > "$rootfs/bad.conf"; then
  mv "$rootfs/bad.conf" "$rootfs/etc/systemd/system/serial-getty@ttyS0.service.d/orca-autologin.conf"
fi
if "$project_root/tools/verify-rootfs.sh" "$rootfs" >/dev/null 2>&1; then
  echo 'rootfs verifier accepted a missing serial autologin override' >&2
  exit 1
fi
test -x "$rootfs/usr/local/bin/orca"
test -x "$rootfs/usr/lib/orca/orca-agent"
test -x "$rootfs/usr/lib/orca/orca-api.py"
test -f "$rootfs/etc/orca-release"
test -f "$rootfs/usr/lib/systemd/system/orca-agent.service"
test -f "$rootfs/usr/lib/systemd/system/orca-api.service"
test -f "$rootfs/etc/systemd/system/serial-getty@ttyS0.service.d/orca-autologin.conf"
test -L "$rootfs/etc/systemd/system/multi-user.target.wants/orca-agent.service"
test -L "$rootfs/etc/systemd/system/multi-user.target.wants/orca-api.service"
