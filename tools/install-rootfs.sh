#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rootfs="${1:?Usage: $0 ROOTFS}"

install -Dm755 "$project_root/cli/orca" "$rootfs/usr/local/bin/orca"
install -Dm755 "$project_root/services/orca-agent" "$rootfs/usr/lib/orca/orca-agent"
install -Dm755 "$project_root/services/orca-api.py" "$rootfs/usr/lib/orca/orca-api.py"
install -Dm644 "$project_root/services/orca-agent.service" "$rootfs/usr/lib/systemd/system/orca-agent.service"
install -Dm644 "$project_root/services/orca-api.service" "$rootfs/usr/lib/systemd/system/orca-api.service"
install -Dm644 "$project_root/config/etc/orca-release" "$rootfs/etc/orca-release"

mkdir -p "$rootfs/etc/systemd/system/multi-user.target.wants"
ln -sfn /usr/lib/systemd/system/orca-agent.service \
  "$rootfs/etc/systemd/system/multi-user.target.wants/orca-agent.service"
ln -sfn /usr/lib/systemd/system/orca-api.service \
  "$rootfs/etc/systemd/system/multi-user.target.wants/orca-api.service"
