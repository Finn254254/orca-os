#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_root="$(mktemp -d)"
trap 'rm -rf "$temp_root"' EXIT
mkdir -p "$temp_root/ssh" "$temp_root/bin" "$temp_root/run" "$temp_root/state"
cat > "$temp_root/bin/ssh-keygen" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == -A ]]
printf private > "$ORCA_SSH_DIR/ssh_host_ed25519_key"
printf public > "$ORCA_SSH_DIR/ssh_host_ed25519_key.pub"
EOF
cat > "$temp_root/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo '{"status":"ok"}'
EOF
chmod +x "$temp_root/bin/"*
ORCA_SSH_DIR="$temp_root/ssh" ORCA_SSH_KEYGEN="$temp_root/bin/ssh-keygen" \
  "$project_root/services/orca-ssh-host-keys"
[[ "$(stat -c '%a' "$temp_root/ssh/ssh_host_ed25519_key")" == 600 ]]
printf existing > "$temp_root/ssh/ssh_host_rsa_key"
ORCA_SSH_DIR="$temp_root/ssh" ORCA_SSH_KEYGEN=false "$project_root/services/orca-ssh-host-keys"

printf '{"nodeId":"test"}\n' > "$temp_root/run/node.json"
printf '%064d\n' 0 > "$temp_root/state/api-token"
ready="$(ORCA_RUNTIME_DIR="$temp_root/run" ORCA_API_TOKEN_FILE="$temp_root/state/api-token" ORCA_CURL="$temp_root/bin/curl" "$project_root/services/orca-core-ready")"
[[ "$ready" == ORCA_CORE_READY ]]
rm "$temp_root/run/node.json"
if ORCA_RUNTIME_DIR="$temp_root/run" ORCA_API_TOKEN_FILE="$temp_root/state/api-token" ORCA_CURL="$temp_root/bin/curl" ORCA_CORE_READY_TIMEOUT=1 "$project_root/services/orca-core-ready" >/dev/null 2>&1; then
  echo 'core readiness passed without a node record' >&2
  exit 1
fi
echo 'Boot initializer tests passed.'
