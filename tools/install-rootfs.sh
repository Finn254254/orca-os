#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rootfs="${1:?Usage: $0 ROOTFS}"
authorized_keys="${ORCA_SSH_AUTHORIZED_KEYS:-}"

install -Dm755 "$project_root/cli/orca" "$rootfs/usr/local/bin/orca"
install -Dm755 "$project_root/services/orca-token-init" "$rootfs/usr/lib/orca/orca-token-init"
install -Dm755 "$project_root/services/orca-first-boot" "$rootfs/usr/lib/orca/orca-first-boot"
install -Dm755 "$project_root/services/orca-ssh-host-keys" "$rootfs/usr/lib/orca/orca-ssh-host-keys"
install -Dm755 "$project_root/services/orca-core-ready" "$rootfs/usr/lib/orca/orca-core-ready"
install -Dm755 "$project_root/services/orca-agent" "$rootfs/usr/lib/orca/orca-agent"
install -Dm755 "$project_root/services/orca-api.py" "$rootfs/usr/lib/orca/orca-api.py"
install -Dm755 "$project_root/services/orca-support-bundle" "$rootfs/usr/lib/orca/orca-support-bundle"
install -Dm755 "$project_root/tools/resource-report.sh" "$rootfs/usr/lib/orca/resource-report"
install -Dm644 "$project_root/services/orca-first-boot.service" "$rootfs/usr/lib/systemd/system/orca-first-boot.service"
install -Dm644 "$project_root/services/orca-ssh-host-keys.service" "$rootfs/usr/lib/systemd/system/orca-ssh-host-keys.service"
install -Dm644 "$project_root/services/orca-agent.service" "$rootfs/usr/lib/systemd/system/orca-agent.service"
install -Dm644 "$project_root/services/orca-api.service" "$rootfs/usr/lib/systemd/system/orca-api.service"
install -Dm644 "$project_root/services/orca-core-ready.service" "$rootfs/usr/lib/systemd/system/orca-core-ready.service"
install -Dm644 "$project_root/services/orca-ready.service" "$rootfs/usr/lib/systemd/system/orca-ready.service"
install -Dm644 "$project_root/config/etc/orca-release" "$rootfs/etc/orca-release"
install -Dm644 "$project_root/config/etc/os-release" "$rootfs/etc/os-release"
install -Dm644 "$project_root/config/systemd/serial-getty@ttyS0.service.d/orca-autologin.conf" \
  "$rootfs/etc/systemd/system/serial-getty@ttyS0.service.d/orca-autologin.conf"
install -Dm644 "$project_root/config/systemd/network/20-orca-wired.network" \
  "$rootfs/etc/systemd/network/20-orca-wired.network"
install -Dm644 "$project_root/config/systemd/system-preset/90-orca.preset" \
  "$rootfs/usr/lib/systemd/system-preset/90-orca.preset"
install -Dm644 "$project_root/config/systemd/system/systemd-networkd-wait-online.service.d/20-orca-timeout.conf" \
  "$rootfs/etc/systemd/system/systemd-networkd-wait-online.service.d/20-orca-timeout.conf"
install -Dm644 "$project_root/config/systemd/journald.conf.d/20-orca-volatile.conf" \
  "$rootfs/etc/systemd/journald.conf.d/20-orca-volatile.conf"
install -Dm644 "$project_root/config/systemd/sysusers.d/orca.conf" \
  "$rootfs/usr/lib/sysusers.d/orca.conf"
install -Dm644 "$project_root/config/ssh/sshd_config.d/20-orca-vm.conf" \
  "$rootfs/etc/ssh/sshd_config.d/20-orca-vm.conf"

if [[ -n "$authorized_keys" ]]; then
  [[ -f "$authorized_keys" ]] || { echo "SSH public key not found: $authorized_keys" >&2; exit 1; }
  install -Dm600 "$authorized_keys" "$rootfs/root/.ssh/authorized_keys"
fi

# A cloneable release image must never ship a reusable SSH server identity.
# Each writable VM overlay or physical device creates its own host keys on boot.
rm -f -- "$rootfs"/etc/ssh/ssh_host_*_key "$rootfs"/etc/ssh/ssh_host_*_key.pub

mkdir -p "$rootfs/etc/systemd/system/multi-user.target.wants"
ln -sfn /usr/lib/systemd/system/orca-first-boot.service \
  "$rootfs/etc/systemd/system/multi-user.target.wants/orca-first-boot.service"
ln -sfn /usr/lib/systemd/system/orca-ssh-host-keys.service \
  "$rootfs/etc/systemd/system/multi-user.target.wants/orca-ssh-host-keys.service"
ln -sfn /usr/lib/systemd/system/orca-agent.service \
  "$rootfs/etc/systemd/system/multi-user.target.wants/orca-agent.service"
ln -sfn /usr/lib/systemd/system/orca-api.service \
  "$rootfs/etc/systemd/system/multi-user.target.wants/orca-api.service"
ln -sfn /usr/lib/systemd/system/orca-core-ready.service \
  "$rootfs/etc/systemd/system/multi-user.target.wants/orca-core-ready.service"
ln -sfn /usr/lib/systemd/system/orca-ready.service \
  "$rootfs/etc/systemd/system/multi-user.target.wants/orca-ready.service"
ln -sfn /lib/systemd/system/systemd-networkd.service \
  "$rootfs/etc/systemd/system/multi-user.target.wants/systemd-networkd.service"
ln -sfn /lib/systemd/system/ssh.service \
  "$rootfs/etc/systemd/system/multi-user.target.wants/ssh.service"

mkdir -p "$rootfs/etc/systemd/system/network-online.target.wants"
ln -sfn /lib/systemd/system/systemd-networkd-wait-online.service \
  "$rootfs/etc/systemd/system/network-online.target.wants/systemd-networkd-wait-online.service"
