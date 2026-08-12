#!/usr/bin/env bash
set -euo pipefail

rootfs="${1:?Usage: $0 ROOTFS}"

required_files=(
  /etc/orca-release
  /etc/os-release
  /usr/local/bin/orca
  /usr/lib/orca/orca-token-init
  /usr/lib/orca/orca-first-boot
  /usr/lib/orca/orca-ssh-host-keys
  /usr/lib/orca/orca-core-ready
  /usr/lib/orca/orca-agent
  /usr/lib/orca/orca-api.py
  /usr/lib/orca/orca-support-bundle
  /usr/lib/orca/resource-report
  /usr/lib/systemd/system/orca-first-boot.service
  /usr/lib/systemd/system/orca-ssh-host-keys.service
  /usr/lib/systemd/system/orca-agent.service
  /usr/lib/systemd/system/orca-api.service
  /usr/lib/systemd/system/orca-core-ready.service
  /usr/lib/systemd/system/orca-ready.service
  /etc/systemd/system/serial-getty@ttyS0.service.d/orca-autologin.conf
  /etc/systemd/network/20-orca-wired.network
  /etc/systemd/system/systemd-networkd-wait-online.service.d/20-orca-timeout.conf
  /etc/systemd/journald.conf.d/20-orca-volatile.conf
  /usr/lib/sysusers.d/orca.conf
  /usr/lib/systemd/system-preset/90-orca.preset
  /etc/ssh/sshd_config.d/20-orca-vm.conf
)

for file in "${required_files[@]}"; do
  [[ -e "$rootfs$file" ]] || { echo "Missing rootfs file: $file" >&2; exit 1; }
done

if compgen -G "$rootfs/etc/ssh/ssh_host_*_key" >/dev/null; then
  echo "Cloneable rootfs contains SSH host private keys." >&2
  exit 1
fi

grep -Fxq 'DHCP=ipv4' "$rootfs/etc/systemd/network/20-orca-wired.network" || {
  echo "Wired DHCP is not configured." >&2
  exit 1
}

for enabled in \
  "$rootfs/etc/systemd/system/multi-user.target.wants/systemd-networkd.service" \
  "$rootfs/etc/systemd/system/multi-user.target.wants/ssh.service" \
  "$rootfs/etc/systemd/system/network-online.target.wants/systemd-networkd-wait-online.service"; do
  [[ -L "$enabled" ]] || { echo "Required system service is not enabled: $enabled" >&2; exit 1; }
done

if [[ -n "${ORCA_REQUIRE_SSH_KEY:-}" ]]; then
  [[ -s "$rootfs/root/.ssh/authorized_keys" ]] || {
    echo "Root SSH authorized_keys is missing." >&2
    exit 1
  }
fi

read_release_value() {
  local key="$1" file="$2"
  awk -F= -v key="$key" '$1 == key { value=substr($0, length(key) + 2); gsub(/^"|"$/, "", value); print value; exit }' "$file"
}

[[ "$(read_release_value ID "$rootfs/etc/os-release")" == "orca" ]] || {
  echo "Standard OS identity is not branded as Orca OS." >&2
  exit 1
}
[[ "$(read_release_value PRETTY_NAME "$rootfs/etc/os-release")" == "$(read_release_value PRETTY_NAME "$rootfs/etc/orca-release")" ]] || {
  echo "Orca release identities do not match." >&2
  exit 1
}
[[ "$(read_release_value VERSION_ID "$rootfs/etc/os-release")" == "$(read_release_value VERSION_ID "$rootfs/etc/orca-release")" ]] || {
  echo "Orca release versions do not match." >&2
  exit 1
}

for executable in \
  /usr/local/bin/orca \
  /usr/lib/orca/orca-token-init \
  /usr/lib/orca/orca-first-boot \
  /usr/lib/orca/orca-agent \
  /usr/lib/orca/orca-api.py \
  /usr/lib/orca/orca-support-bundle \
  /usr/lib/orca/resource-report; do
  [[ -x "$rootfs$executable" ]] || { echo "Required Orca executable is not executable: $executable" >&2; exit 1; }
done

for unit in orca-first-boot orca-ssh-host-keys orca-agent orca-api orca-core-ready orca-ready; do
  enabled="$rootfs/etc/systemd/system/multi-user.target.wants/$unit.service"
  [[ -L "$enabled" ]] || { echo "Unit is not enabled: $unit" >&2; exit 1; }
  [[ "$(readlink "$enabled")" == "/usr/lib/systemd/system/$unit.service" ]] || {
    echo "Unit has an unexpected target: $unit" >&2; exit 1;
  }
done

for unit in orca-first-boot orca-agent orca-api; do
  unit_file="$rootfs/usr/lib/systemd/system/$unit.service"
  for directive in \
    'NoNewPrivileges=true' \
    'PrivateDevices=true' \
    'ProtectSystem=strict' \
    'ProtectKernelModules=true' \
    'RestrictSUIDSGID=true' \
    'CapabilityBoundingSet='; do
    grep -Fxq "$directive" "$unit_file" || {
      echo "Required service hardening is missing from $unit: $directive" >&2
      exit 1
    }
  done
done

for unit in orca-first-boot orca-agent orca-api; do
  unit_file="$rootfs/usr/lib/systemd/system/$unit.service"
  for directive in 'MemoryAccounting=true' 'CPUAccounting=true' 'LimitNOFILE='; do
    grep -q "^$directive" "$unit_file" || {
      echo "Required service resource control is missing from $unit: $directive" >&2
      exit 1
    }
  done
done

grep -Fxq 'RestrictAddressFamilies=AF_INET AF_INET6' "$rootfs/usr/lib/systemd/system/orca-api.service" || {
  echo "Orca API socket families are not restricted." >&2
  exit 1
}
grep -Fq -- '--token-file /var/lib/orca/api-token' "$rootfs/usr/lib/systemd/system/orca-api.service" || {
  echo "Orca API bearer-token configuration is missing." >&2
  exit 1
}
grep -Fxq 'User=orca-api' "$rootfs/usr/lib/systemd/system/orca-api.service" || {
  echo "Orca API does not run as its dedicated unprivileged user." >&2
  exit 1
}
grep -Fxq 'ReadOnlyPaths=/run/orca /var/lib/orca' "$rootfs/usr/lib/systemd/system/orca-api.service" || {
  echo "Orca API state access is not read-only." >&2
  exit 1
}
grep -Fxq 'Storage=volatile' "$rootfs/etc/systemd/journald.conf.d/20-orca-volatile.conf" || {
  echo "Volatile low-write journal policy is missing." >&2
  exit 1
}
grep -Fq -- '--timeout=20' "$rootfs/etc/systemd/system/systemd-networkd-wait-online.service.d/20-orca-timeout.conf" || {
  echo "Bounded network-online wait is missing." >&2
  exit 1
}
grep -Fq 'ExecStart=/usr/lib/orca/orca-core-ready' "$rootfs/usr/lib/systemd/system/orca-core-ready.service" || {
  echo "Offline-capable core readiness probe is not configured." >&2
  exit 1
}

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
