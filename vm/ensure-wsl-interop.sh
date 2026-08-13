#!/usr/bin/env bash
set -euo pipefail

[[ -r /proc/sys/kernel/osrelease ]] && grep -qi microsoft /proc/sys/kernel/osrelease || exit 0
[[ -e /proc/sys/fs/binfmt_misc/WSLInterop ]] && exit 0

command -v flock >/dev/null || {
  echo "Cannot restore Windows executable interoperability: flock is unavailable." >&2
  exit 1
}
exec 9<"${BASH_SOURCE[0]}"
flock 9
[[ -e /proc/sys/fs/binfmt_misc/WSLInterop ]] && exit 0

distribution="${WSL_DISTRO_NAME:-}"
[[ -n "$distribution" && "$distribution" =~ ^[A-Za-z0-9._+-]+$ ]] || {
  echo "Cannot restore Windows executable interoperability: WSL_DISTRO_NAME is unavailable or invalid." >&2
  exit 1
}

wsl_exe=/mnt/c/Windows/System32/wsl.exe
[[ -f "$wsl_exe" ]] || {
  echo "Cannot restore Windows executable interoperability: wsl.exe was not found." >&2
  exit 1
}

echo "Restoring WSL Windows-executable interoperability..." >&2
/init "$wsl_exe" "$wsl_exe" -d "$distribution" -u root -- /bin/sh -c \
  "printf ':WSLInterop:M::MZ::/init:P' > /proc/sys/fs/binfmt_misc/register"

[[ -e /proc/sys/fs/binfmt_misc/WSLInterop ]] || {
  echo "Windows executable interoperability could not be restored." >&2
  exit 1
}
