#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="$($project_root/build/build-image.sh --dry-run)"
grep -q 'mkosi build definition' <<<"$output"
grep -q 'Architecture=x86-64' "$project_root/build/mkosi.conf"
grep -q 'Format=disk' "$project_root/build/mkosi.conf"
grep -q 'systemd-boot-efi' "$project_root/build/mkosi.conf"
grep -q 'Firmware=uefi' "$project_root/build/mkosi.conf"
grep -q 'SOURCE_DATE_EPOCH' "$project_root/build/build-image.sh"

vm_root="$(mktemp -d)"
trap 'rm -rf "$vm_root"' EXIT
touch "$vm_root/image.raw" "$vm_root/OVMF_CODE.fd" "$vm_root/OVMF_VARS.fd"
mkdir -p "$vm_root/bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$vm_root/bin/qemu-system-x86_64"
chmod +x "$vm_root/bin/qemu-system-x86_64"
vm_output="$(PATH="$vm_root/bin:$PATH" ORCA_IMAGE="$vm_root/image.raw" ORCA_OVMF_CODE="$vm_root/OVMF_CODE.fd" ORCA_OVMF_VARS="$vm_root/OVMF_VARS.fd" ORCA_OVMF_VARS_COPY="$vm_root/OVMF_VARS_COPY.fd" "$project_root/vm/run-qemu.sh" --dry-run)"
grep -q 'if=pflash' <<<"$vm_output"
