#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="$($project_root/build/build-image.sh --dry-run)"
grep -q 'mkosi build definition' <<<"$output"
grep -q 'Architecture=x86-64' "$project_root/build/mkosi.conf"
grep -q 'Format=disk' "$project_root/build/mkosi.conf"
grep -q 'systemd-boot-efi' "$project_root/build/mkosi.conf"
grep -q 'Firmware=uefi' "$project_root/build/mkosi.conf"
grep -q 'Autologin=yes' "$project_root/build/mkosi.conf"
grep -q 'SOURCE_DATE_EPOCH' "$project_root/build/build-image.sh"
verify_output="$($project_root/build/verify-image.sh image.raw --dry-run)"
grep -q 'GPT and EFI partition' <<<"$verify_output"

vm_root="$(mktemp -d)"
smoke_root=""
trap 'rm -rf "$vm_root" "${smoke_root:-}"' EXIT
touch "$vm_root/image.raw" "$vm_root/OVMF_CODE.fd" "$vm_root/OVMF_VARS.fd"
mkdir -p "$vm_root/bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$vm_root/bin/qemu-system-x86_64"
chmod +x "$vm_root/bin/qemu-system-x86_64"
vm_output="$(PATH="$vm_root/bin:$PATH" ORCA_IMAGE="$vm_root/image.raw" ORCA_OVMF_CODE="$vm_root/OVMF_CODE.fd" ORCA_OVMF_VARS="$vm_root/OVMF_VARS.fd" ORCA_OVMF_VARS_COPY="$vm_root/OVMF_VARS_COPY.fd" "$project_root/vm/run-qemu.sh" --dry-run)"
grep -q 'if=pflash' <<<"$vm_output"
grep -q 'sudo env "PATH=$PATH"' "$project_root/.github/workflows/build-image.yml"

smoke_root="$(mktemp -d)"
mkdir -p "$smoke_root/bin"
touch "$smoke_root/image.raw" "$smoke_root/OVMF_CODE.fd" "$smoke_root/OVMF_VARS.fd"
cat > "$smoke_root/bin/qemu-system-x86_64" <<'EOF'
#!/usr/bin/env bash
for argument in "$@"; do
  case "$argument" in
    file:*) printf ORCA_OS_READY > "${argument#file:}" ;;
  esac
done
exec tail -f /dev/null
EOF
chmod +x "$smoke_root/bin/qemu-system-x86_64"
PATH="$smoke_root/bin:$PATH" \
ORCA_IMAGE="$smoke_root/image.raw" \
ORCA_OVMF_CODE="$smoke_root/OVMF_CODE.fd" \
ORCA_OVMF_VARS="$smoke_root/OVMF_VARS.fd" \
ORCA_OVMF_VARS_COPY="$smoke_root/OVMF_VARS_COPY.fd" \
ORCA_VM_LOG="$smoke_root/boot.log" \
ORCA_VM_BOOT_TIMEOUT=5 \
  "$project_root/vm/smoke-test.sh" >/dev/null
