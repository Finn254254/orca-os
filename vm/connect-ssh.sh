#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ssh_key="${ORCA_VM_SSH_KEY:-$project_root/out/orca-vm.id_ed25519}"
ssh_port="${ORCA_VM_SSH_PORT:-2222}"

[[ -f "$ssh_key" ]] || { echo "VM SSH key not found: $ssh_key. Run 'make image'." >&2; exit 1; }

ssh_client="ssh"
key_argument="$ssh_key"
known_hosts="/dev/null"
if grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then
  ssh_client="/mnt/c/Windows/System32/OpenSSH/ssh.exe"
  [[ -x "$ssh_client" ]] || { echo "Windows OpenSSH client was not found." >&2; exit 1; }
  key_argument="$("$project_root/vm/prepare-windows-ssh-key.sh" "$ssh_key")"
  known_hosts="NUL"
fi

exec "$ssh_client" \
  -i "$key_argument" \
  -p "$ssh_port" \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile="$known_hosts" \
  root@127.0.0.1 "$@"
