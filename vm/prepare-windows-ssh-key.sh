#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_key="${1:?Usage: $0 SOURCE_KEY}"
[[ -f "$source_key" ]] || { echo "SSH key not found: $source_key" >&2; exit 1; }

"$project_root/vm/ensure-wsl-interop.sh"

cmd_exe=/mnt/c/Windows/System32/cmd.exe
icacls_exe=/mnt/c/Windows/System32/icacls.exe
local_appdata="$(cd /mnt/c/Windows && $cmd_exe /d /c 'echo %LOCALAPPDATA%' | tr -d '\r')"
windows_user="$(cd /mnt/c/Windows && $cmd_exe /d /c 'echo %USERNAME%' | tr -d '\r')"
[[ -n "$local_appdata" && -n "$windows_user" ]] || { echo "Could not detect the Windows profile." >&2; exit 1; }

key_dir="$(wslpath -u "$local_appdata")/OrcaOS"
key_file="$key_dir/orca-vm.id_ed25519"
mkdir -p "$key_dir"
key_windows="$(wslpath -w "$key_file")"
if [[ ! -f "$key_file" ]] || ! cmp -s "$source_key" "$key_file"; then
  [[ ! -f "$key_file" ]] || $icacls_exe "$key_windows" /grant:r "${windows_user}:(F)" >/dev/null
  cp "$source_key" "$key_file"
fi
$icacls_exe "$key_windows" /inheritance:r /grant:r "${windows_user}:(R)" >/dev/null
printf '%s\n' "$key_windows"
