#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="${ORCA_OUTPUT_DIR:-$project_root/out}"
stage_dir="${ORCA_STAGE_DIR:-$output_dir/stage-rootfs}"
source_date_epoch="${SOURCE_DATE_EPOCH:-0}"
ssh_key="${ORCA_VM_SSH_KEY:-$output_dir/orca-vm.id_ed25519}"
size_report="$output_dir/orca-os-x86_64.size-report.json"

if [[ "${1:-}" == "--dry-run" ]]; then
  printf 'mkosi build definition: %s\n' "$project_root/build/mkosi.conf"
  printf 'rootfs installer: %s\n' "$project_root/tools/install-rootfs.sh"
  exit 0
fi

command -v mkosi >/dev/null || {
  echo "mkosi is required. Install it from your Linux distribution or https://github.com/systemd/mkosi." >&2
  exit 1
}
command -v ssh-keygen >/dev/null || {
  echo "ssh-keygen is required to provision VM access." >&2
  exit 1
}

output_dir="$(realpath -m -- "$output_dir")"
stage_dir="$(realpath -m -- "$stage_dir")"
ssh_key="$(realpath -m -- "$ssh_key")"
size_report="$output_dir/orca-os-x86_64.size-report.json"
[[ "$output_dir" != / && "$stage_dir" != / && "$stage_dir" != "$output_dir" && "$stage_dir" == "$output_dir/"* ]] || {
  echo "The staging directory must be a dedicated child of the output directory." >&2
  exit 2
}
[[ ! -L "$stage_dir" ]] || {
  echo "Refusing to replace a symlinked staging directory: $stage_dir" >&2
  exit 2
}

mkdir -p "$output_dir"
if [[ ! -f "$ssh_key" ]]; then
  ssh-keygen -q -t ed25519 -N '' -C 'orca-os-development-vm' -f "$ssh_key"
fi
[[ -f "$ssh_key.pub" ]] || ssh-keygen -y -f "$ssh_key" > "$ssh_key.pub"
chmod 600 "$ssh_key"

echo "Resetting verified staging directory: $stage_dir"
rm -rf -- "$stage_dir"
mkdir -p "$stage_dir"
ORCA_SSH_AUTHORIZED_KEYS="$ssh_key.pub" \
  "$project_root/tools/install-rootfs.sh" "$stage_dir"
ORCA_REQUIRE_SSH_KEY=1 "$project_root/tools/verify-rootfs.sh" "$stage_dir"

image="$output_dir/orca-os-x86_64.raw"
rm -f -- "$image" "$image.sha256" "$image.manifest.json" "$size_report"
SOURCE_DATE_EPOCH="$source_date_epoch" mkosi -C "$project_root/build" -f \
  --output-dir="$output_dir" \
  --extra-tree="$stage_dir" \
  build

"$project_root/build/verify-image.sh" "$image"
"$project_root/build/check-size-budget.sh" \
  "$image" "$output_dir/orca-os-x86_64.initrd" "$output_dir/orca-os-x86_64.efi" "$size_report"
SOURCE_DATE_EPOCH="$source_date_epoch" "$project_root/build/write-manifest.sh" "$image"
if [[ -n "${SUDO_UID:-}" && -n "${SUDO_GID:-}" ]]; then
  chown "$SUDO_UID:$SUDO_GID" "$ssh_key" "$ssh_key.pub" \
    "$image" "$image.sha256" "$image.manifest.json" "$size_report"
fi
echo "Built $image"
