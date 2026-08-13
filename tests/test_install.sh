#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rootfs="$(mktemp -d)"
production_rootfs="$(mktemp -d)"
trap 'rm -rf "$rootfs" "$production_rootfs"' EXIT

ORCA_BUILD_PROFILE=vm-development "$project_root/tools/install-rootfs.sh" "$rootfs"
ORCA_BUILD_PROFILE=vm-development "$project_root/tools/verify-rootfs.sh" "$rootfs"
cp "$rootfs/usr/lib/systemd/system/orca-api.service" "$rootfs/orca-api.service.valid"
sed '/^CapabilityBoundingSet=$/d' "$rootfs/orca-api.service.valid" > "$rootfs/usr/lib/systemd/system/orca-api.service"
if ORCA_BUILD_PROFILE=vm-development "$project_root/tools/verify-rootfs.sh" "$rootfs" >/dev/null 2>&1; then
  echo 'rootfs verifier accepted an unhardened API service' >&2
  exit 1
fi
mv "$rootfs/orca-api.service.valid" "$rootfs/usr/lib/systemd/system/orca-api.service"
cp "$rootfs/etc/os-release" "$rootfs/etc/os-release.valid"
sed 's/^ID=orca$/ID=debian/' "$rootfs/etc/os-release.valid" > "$rootfs/etc/os-release"
if ORCA_BUILD_PROFILE=vm-development "$project_root/tools/verify-rootfs.sh" "$rootfs" >/dev/null 2>&1; then
  echo 'rootfs verifier accepted an unbranded standard OS identity' >&2
  exit 1
fi
mv "$rootfs/etc/os-release.valid" "$rootfs/etc/os-release"
if sed 's/--autologin root/--login-options/' "$rootfs/etc/systemd/system/serial-getty@ttyS0.service.d/orca-autologin.conf" > "$rootfs/bad.conf"; then
  mv "$rootfs/bad.conf" "$rootfs/etc/systemd/system/serial-getty@ttyS0.service.d/orca-autologin.conf"
fi
if ORCA_BUILD_PROFILE=vm-development "$project_root/tools/verify-rootfs.sh" "$rootfs" >/dev/null 2>&1; then
  echo 'rootfs verifier accepted a missing serial autologin override' >&2
  exit 1
fi
test -x "$rootfs/usr/local/bin/orca"
test -x "$rootfs/usr/lib/orca/orca-token-init"
test -x "$rootfs/usr/lib/orca/orca-first-boot"
test -x "$rootfs/usr/lib/orca/orca-ssh-host-keys"
test -x "$rootfs/usr/lib/orca/orca-core-ready"
test -x "$rootfs/usr/lib/orca/orca-agent"
test -x "$rootfs/usr/lib/orca/orca-api.py"
test -x "$rootfs/usr/lib/orca/orca-support-bundle"
test -x "$rootfs/usr/lib/orca/resource-report"
test -f "$rootfs/etc/orca-release"
test -f "$rootfs/etc/os-release"
grep -q '^ID=orca$' "$rootfs/etc/os-release"
grep -q '^ANSI_COLOR="1;38;2;255;106;57"$' "$rootfs/etc/os-release"
test -f "$rootfs/usr/lib/systemd/system/orca-first-boot.service"
test -f "$rootfs/usr/lib/systemd/system/orca-ssh-host-keys.service"
test -f "$rootfs/usr/lib/systemd/system/orca-agent.service"
test -f "$rootfs/usr/lib/systemd/system/orca-api.service"
test -f "$rootfs/usr/lib/systemd/system/orca-core-ready.service"
test -f "$rootfs/usr/lib/systemd/system/orca-ready.service"
test -f "$rootfs/etc/systemd/system/serial-getty@ttyS0.service.d/orca-autologin.conf"
test -f "$rootfs/etc/systemd/network/20-orca-wired.network"
test -f "$rootfs/usr/lib/systemd/system-preset/90-orca-common.preset"
test -f "$rootfs/usr/lib/systemd/system-preset/91-orca-vm-development.preset"
test ! -e "$rootfs/etc/systemd/system/sockets.target.wants/ssh.socket"
test -f "$rootfs/etc/ssh/sshd_config.d/20-orca-vm.conf"
test -f "$rootfs/etc/systemd/journald.conf.d/20-orca-volatile.conf"
test -f "$rootfs/usr/lib/sysusers.d/orca.conf"
test -f "$rootfs/etc/systemd/system/systemd-networkd-wait-online.service.d/20-orca-timeout.conf"
test -L "$rootfs/etc/systemd/system/multi-user.target.wants/orca-first-boot.service"
test -L "$rootfs/etc/systemd/system/multi-user.target.wants/orca-ssh-host-keys.service"
test -L "$rootfs/etc/systemd/system/multi-user.target.wants/orca-agent.service"
test -L "$rootfs/etc/systemd/system/multi-user.target.wants/orca-api.service"
test -L "$rootfs/etc/systemd/system/multi-user.target.wants/orca-core-ready.service"
test -L "$rootfs/etc/systemd/system/multi-user.target.wants/orca-ready.service"
test -L "$rootfs/etc/systemd/system/multi-user.target.wants/systemd-networkd.service"
test -L "$rootfs/etc/systemd/system/multi-user.target.wants/ssh.service"
test -L "$rootfs/etc/systemd/system/network-online.target.wants/systemd-networkd-wait-online.service"
grep -q '^DHCP=ipv4$' "$rootfs/etc/systemd/network/20-orca-wired.network"
grep -q '^PermitRootLogin prohibit-password$' "$rootfs/etc/ssh/sshd_config.d/20-orca-vm.conf"
grep -q -- '--host 0.0.0.0' "$rootfs/usr/lib/systemd/system/orca-api.service"
grep -q -- '--token-file /var/lib/orca/api-token' "$rootfs/usr/lib/systemd/system/orca-api.service"
grep -q '^Storage=volatile$' "$rootfs/etc/systemd/journald.conf.d/20-orca-volatile.conf"
grep -q '^u orca-api ' "$rootfs/usr/lib/sysusers.d/orca.conf"
grep -q '^User=orca-api$' "$rootfs/usr/lib/systemd/system/orca-api.service"
if compgen -G "$rootfs/etc/ssh/ssh_host_*_key" >/dev/null; then
  echo 'rootfs installer left SSH host private keys in the cloneable image' >&2
  exit 1
fi

ORCA_BUILD_PROFILE=production-board "$project_root/tools/install-rootfs.sh" "$production_rootfs"
ORCA_BUILD_PROFILE=production-board "$project_root/tools/verify-rootfs.sh" "$production_rootfs"
[[ "$(cat "$production_rootfs/etc/orca-profile")" == production-board ]]
test -f "$production_rootfs/etc/systemd/system/orca-api.service.d/20-orca-production.conf"
grep -q -- '--host 127.0.0.1' "$production_rootfs/etc/systemd/system/orca-api.service.d/20-orca-production.conf"
test ! -e "$production_rootfs/etc/systemd/system/serial-getty@ttyS0.service.d/orca-autologin.conf"
test ! -e "$production_rootfs/etc/ssh/sshd_config.d/20-orca-vm.conf"
test ! -e "$production_rootfs/root/.ssh/authorized_keys"
test ! -L "$production_rootfs/etc/systemd/system/multi-user.target.wants/ssh.service"
test ! -L "$production_rootfs/etc/systemd/system/multi-user.target.wants/orca-ssh-host-keys.service"
test -f "$production_rootfs/usr/lib/systemd/system-preset/91-orca-production-board.preset"
printf 'ssh-ed25519 AAAATEST forbidden\n' > "$production_rootfs/test-authorized-key"
if ORCA_BUILD_PROFILE=production-board ORCA_SSH_AUTHORIZED_KEYS="$production_rootfs/test-authorized-key" \
  "$project_root/tools/install-rootfs.sh" "$production_rootfs" >/dev/null 2>&1; then
  echo 'production rootfs installer accepted a development root SSH key' >&2
  exit 1
fi
