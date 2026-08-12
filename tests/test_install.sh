#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rootfs="$(mktemp -d)"
trap 'rm -rf "$rootfs"' EXIT

"$project_root/tools/install-rootfs.sh" "$rootfs"
"$project_root/tools/verify-rootfs.sh" "$rootfs"
cp "$rootfs/etc/os-release" "$rootfs/etc/os-release.valid"
sed 's/^ID=orca$/ID=debian/' "$rootfs/etc/os-release.valid" > "$rootfs/etc/os-release"
if "$project_root/tools/verify-rootfs.sh" "$rootfs" >/dev/null 2>&1; then
  echo 'rootfs verifier accepted an unbranded standard OS identity' >&2
  exit 1
fi
mv "$rootfs/etc/os-release.valid" "$rootfs/etc/os-release"
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
test -f "$rootfs/etc/os-release"
grep -q '^ID=orca$' "$rootfs/etc/os-release"
grep -q '^ANSI_COLOR="1;38;2;255;106;57"$' "$rootfs/etc/os-release"
test -f "$rootfs/usr/lib/systemd/system/orca-agent.service"
test -f "$rootfs/usr/lib/systemd/system/orca-api.service"
test -f "$rootfs/usr/lib/systemd/system/orca-ready.service"
test -f "$rootfs/etc/systemd/system/serial-getty@ttyS0.service.d/orca-autologin.conf"
test -L "$rootfs/etc/systemd/system/multi-user.target.wants/orca-agent.service"
test -L "$rootfs/etc/systemd/system/multi-user.target.wants/orca-api.service"
test -L "$rootfs/etc/systemd/system/multi-user.target.wants/orca-ready.service"
