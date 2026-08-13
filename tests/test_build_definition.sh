#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="$($project_root/build/build-image.sh --dry-run)"
grep -q 'mkosi build definition' <<<"$output"
grep -q 'build profile: vm-development' <<<"$output"
production_output="$(ORCA_BUILD_PROFILE=production-board $project_root/build/build-image.sh --dry-run)"
grep -q 'build profile: production-board' <<<"$production_output"
grep -q 'orca-os-x86_64-production-board.raw' <<<"$production_output"
grep -q 'Architecture=x86-64' "$project_root/build/mkosi.conf"
grep -q 'Format=disk' "$project_root/build/mkosi.conf"
grep -q '^Output=orca-os-x86_64$' "$project_root/build/mkosi.conf"
if grep -q 'Output=.*\.raw' "$project_root/build/mkosi.conf"; then
  echo 'mkosi output name would produce a duplicated .raw suffix' >&2
  exit 1
fi
grep -q 'systemd-boot-efi' "$project_root/build/mkosi.conf"
grep -q 'Firmware=uefi' "$project_root/build/mkosi.conf"
grep -q 'Autologin=no' "$project_root/build/mkosi.conf"
grep -q 'Autologin=yes' "$project_root/build/mkosi.profiles/vm-development.conf"
grep -q '^Output=orca-os-x86_64-production-board$' "$project_root/build/mkosi.profiles/production-board.conf"
grep -q 'qemu-guest-agent' "$project_root/build/mkosi.profiles/vm-development.conf"
if grep -q 'qemu-guest-agent\|openssh-server\|sudo' "$project_root/build/mkosi.conf"; then
  echo 'common mkosi configuration contains a VM-only package' >&2
  exit 1
fi
test -x "$project_root/build/mkosi.postinst"
grep -q 'ssh_host_.*_key' "$project_root/build/mkosi.postinst"
grep -q 'RootPassword=hashed:' "$project_root/build/mkosi.profiles/vm-development.conf"
if grep -q 'RootPassword=' "$project_root/build/mkosi.profiles/production-board.conf"; then
  echo 'production profile explicitly configures a root password' >&2
  exit 1
fi
grep -q -- '--output-dir=' "$project_root/build/build-image.sh"
grep -q '90-orca-common.preset' "$project_root/tools/install-rootfs.sh"
grep -q '91-orca-vm-development.preset' "$project_root/tools/install-rootfs.sh"
grep -q '91-orca-production-board.preset' "$project_root/tools/install-rootfs.sh"
grep -q 'SOURCE_DATE_EPOCH' "$project_root/build/build-image.sh"
grep -q 'check-size-budget.sh' "$project_root/build/build-image.sh"
grep -q 'stage_dir.*output_dir/' "$project_root/build/build-image.sh"
verify_output="$($project_root/build/verify-image.sh image.raw --dry-run)"
grep -q 'GPT and EFI partition' <<<"$verify_output"

manifest_root="$(mktemp -d)"
vm_root=""
smoke_root=""
cleanup() {
  [[ -z "$smoke_root" ]] || rm -rf -- "$smoke_root"
  [[ -z "$vm_root" ]] || rm -rf -- "$vm_root"
  rm -rf -- "$manifest_root"
}
trap cleanup EXIT
printf 'orca-image' > "$manifest_root/orca-os-x86_64.raw"
SOURCE_DATE_EPOCH=0 "$project_root/build/write-manifest.sh" "$manifest_root/orca-os-x86_64.raw" "$manifest_root/manifest.json" >/dev/null
python3 - "$manifest_root/manifest.json" <<'PY'
import hashlib
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["schemaVersion"] == 1
assert payload["architecture"] == "x86_64"
assert payload["artifact"]["filename"] == "orca-os-x86_64.raw"
assert payload["artifact"]["sha256"] == hashlib.sha256(b"orca-image").hexdigest()
assert payload["artifact"]["sizeBytes"] == len(b"orca-image")
assert payload["profile"] == "x86_64-development-vm"
assert payload["sourceDateEpoch"] == 0
assert payload["buildTimestamp"] == "1970-01-01T00:00:00Z"
PY
ORCA_IMAGE_PROFILE=x86_64-production-board SOURCE_DATE_EPOCH=0 \
  "$project_root/build/write-manifest.sh" "$manifest_root/orca-os-x86_64.raw" "$manifest_root/production-manifest.json" >/dev/null
python3 - "$manifest_root/production-manifest.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["profile"] == "x86_64-production-board"
PY

vm_root="$(mktemp -d)"
touch "$vm_root/image.raw" "$vm_root/OVMF_CODE.fd" "$vm_root/OVMF_VARS.fd"
mkdir -p "$vm_root/bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$vm_root/bin/qemu-system-x86_64"
chmod +x "$vm_root/bin/qemu-system-x86_64"
vm_output="$(PATH="$vm_root/bin:$PATH" ORCA_IMAGE="$vm_root/image.raw" ORCA_OVMF_CODE="$vm_root/OVMF_CODE.fd" ORCA_OVMF_VARS="$vm_root/OVMF_VARS.fd" ORCA_OVMF_VARS_COPY="$vm_root/OVMF_VARS_COPY.fd" "$project_root/vm/run-qemu.sh" --dry-run)"
grep -q 'if=pflash' <<<"$vm_output"
grep -q 'hostfwd=tcp:127.0.0.1:9876-:9876' <<<"$vm_output"
grep -q 'mac=02:4f:52:43:41:00' <<<"$vm_output"
if PATH="$vm_root/bin:$PATH" ORCA_IMAGE="$vm_root/image.raw" ORCA_OVMF_CODE="$vm_root/OVMF_CODE.fd" ORCA_OVMF_VARS="$vm_root/OVMF_VARS.fd" ORCA_VM_API_PORT=70000 "$project_root/vm/run-qemu.sh" --dry-run >/dev/null 2>&1; then
  echo 'VM launcher accepted an invalid forwarded port' >&2
  exit 1
fi
grep -q 'sudo env "PATH=$PATH"' "$project_root/.github/workflows/build-image.yml"
grep -q 'orca-os-x86_64.raw.manifest.json' "$project_root/.github/workflows/build-image.yml"

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
exec python3 - "$ORCA_VM_API_PORT" <<'PY'
import http.server
import sys

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'{"status":"ok"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass

http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
PY
EOF
chmod +x "$smoke_root/bin/qemu-system-x86_64"
PATH="$smoke_root/bin:$PATH" \
ORCA_IMAGE="$smoke_root/image.raw" \
ORCA_OVMF_CODE="$smoke_root/OVMF_CODE.fd" \
ORCA_OVMF_VARS="$smoke_root/OVMF_VARS.fd" \
ORCA_OVMF_VARS_COPY="$smoke_root/OVMF_VARS_COPY.fd" \
ORCA_VM_LOG="$smoke_root/boot.log" \
ORCA_VM_BOOT_TIMEOUT=5 \
ORCA_VM_FORCE_LINUX=1 \
  "$project_root/vm/smoke-test.sh" >/dev/null

windows_output="$(ORCA_IMAGE="$vm_root/image.raw" ORCA_OVMF_CODE="$vm_root/OVMF_CODE.fd" ORCA_OVMF_VARS="$vm_root/OVMF_VARS.fd" ORCA_OVMF_VARS_COPY="$vm_root/OVMF_VARS_COPY.fd" ORCA_QEMU_WINDOWS="$vm_root/bin/qemu-system-x86_64" "$project_root/vm/run-windows.sh" --dry-run)"
grep -q -- '-accel whpx' <<<"$windows_output"
grep -q 'format=qcow2' <<<"$windows_output"
grep -q 'hostfwd=tcp:127.0.0.1:2222-:22' <<<"$windows_output"
grep -q 'hostfwd=tcp:127.0.0.1:9876-:9876' <<<"$windows_output"
grep -q 'mac=02:4f:52:43:41:00' <<<"$windows_output"
custom_mac_output="$(ORCA_IMAGE="$vm_root/image.raw" ORCA_OVMF_CODE="$vm_root/OVMF_CODE.fd" ORCA_OVMF_VARS="$vm_root/OVMF_VARS.fd" ORCA_OVMF_VARS_COPY="$vm_root/OVMF_VARS_COPY.fd" ORCA_QEMU_WINDOWS="$vm_root/bin/qemu-system-x86_64" ORCA_VM_MAC=02:4f:52:43:41:99 "$project_root/vm/run-windows.sh" --dry-run)"
grep -q 'mac=02:4f:52:43:41:99' <<<"$custom_mac_output"
if ORCA_IMAGE="$vm_root/image.raw" ORCA_OVMF_CODE="$vm_root/OVMF_CODE.fd" ORCA_OVMF_VARS="$vm_root/OVMF_VARS.fd" ORCA_QEMU_WINDOWS="$vm_root/bin/qemu-system-x86_64" ORCA_VM_MAC=01:00:00:00:00:01 "$project_root/vm/run-windows.sh" --dry-run >/dev/null 2>&1; then
  echo 'Windows VM launcher accepted a multicast MAC' >&2
  exit 1
fi
grep -q 'Get-CimInstance Win32_Process' "$project_root/vm/stop-windows-qemu.ps1"
grep -q 'ExpectedOverlay' "$project_root/vm/stop-windows-qemu.ps1"
test -x "$project_root/vm/ensure-wsl-interop.sh"
grep -Fq '/init "$wsl_exe"' "$project_root/vm/ensure-wsl-interop.sh"
if grep -q 'sudo tee /proc/sys/fs/binfmt_misc' \
    "$project_root/vm/run-windows.sh" \
    "$project_root/vm/prepare-windows-ssh-key.sh"; then
  echo 'Windows helpers must not require interactive sudo to restore WSL interop' >&2
  exit 1
fi
