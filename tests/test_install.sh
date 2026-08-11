#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rootfs="$(mktemp -d)"
trap 'rm -rf "$rootfs"' EXIT

"$project_root/tools/install-rootfs.sh" "$rootfs"
test -x "$rootfs/usr/local/bin/orca"
test -x "$rootfs/usr/lib/orca/orca-agent"
test -f "$rootfs/etc/orca-release"
test -f "$rootfs/usr/lib/systemd/system/orca-agent.service"
test -L "$rootfs/etc/systemd/system/multi-user.target.wants/orca-agent.service"
