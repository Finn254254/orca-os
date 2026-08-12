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

manifest_root="$(mktemp -d)"
trap 'rm -rf "$vm_root" "${smoke_root:-}" "$manifest_root"' EXIT
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
assert payload["sourceDateEpoch"] == 0
assert payload["buildTimestamp"] == "1970-01-01T00:00:00Z"
PY

vm_root="$(mktemp -d)"
smoke_root=""
trap 'rm -rf "$vm_root" "${smoke_root:-}"' EXIT
touch "$vm_root/image.raw" "$vm_root/OVMF_CODE.fd" "$vm_root/OVMF_VARS.fd"
mkdir -p "$vm_root/bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$vm_root/bin/qemu-system-x86_64"
chmod +x "$vm_root/bin/qemu-system-x86_64"
vm_output="$(PATH="$vm_root/bin:$PATH" ORCA_IMAGE="$vm_root/image.raw" ORCA_OVMF_CODE="$vm_root/OVMF_CODE.fd" ORCA_OVMF_VARS="$vm_root/OVMF_VARS.fd" ORCA_OVMF_VARS_COPY="$vm_root/OVMF_VARS_COPY.fd" "$project_root/vm/run-qemu.sh" --dry-run)"
grep -q 'if=pflash' <<<"$vm_output"
grep -q 'hostfwd=tcp:127.0.0.1:9876-:9876' <<<"$vm_output"
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
  "$project_root/vm/smoke-test.sh" >/dev/null
