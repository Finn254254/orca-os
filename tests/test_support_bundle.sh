#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bundle_script="$project_root/services/orca-support-bundle"
temp_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "$temp_dir"
}
trap cleanup EXIT INT TERM

fake_root="$temp_dir/root"
fake_bin="$temp_dir/bin"
mkdir -p "$fake_root/etc" "$fake_root/var/lib/orca" "$fake_root/root/.ssh" "$fake_bin" "$temp_dir/extracted"
printf 'ORCA_VERSION=0.1.0-test\n' > "$fake_root/etc/orca-release"
printf 'ORCA_API_TOKEN_SENTINEL_DO_NOT_ARCHIVE\n' > "$fake_root/var/lib/orca/api-token"
cat > "$fake_root/root/.ssh/id_ed25519" <<'EOF'
-----BEGIN OPENSSH PRIVATE KEY-----
SSH_PRIVATE_KEY_SENTINEL_DO_NOT_ARCHIVE
-----END OPENSSH PRIVATE KEY-----
EOF

cat > "$fake_bin/orca" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${ORCA_ROOT:-}" == "${EXPECTED_ORCA_ROOT:?}" ]]
case "$*" in
  'node show') echo '{"schemaVersion":1,"nodeId":"support-test-node"}' ;;
  'info --json') echo '{"schemaVersion":1,"version":"0.1.0-test"}' ;;
  'doctor --json') echo '{"schemaVersion":1,"status":"ok"}' ;;
  'services --json') echo '{"schemaVersion":1,"services":[{"name":"orca-agent","state":"active"}]}' ;;
  'network --json') echo '{"schemaVersion":1,"interfaces":[{"name":"eth0","ipv4":["192.0.2.2"]}]}' ;;
  'platform --json') echo '{"schemaVersion":1,"platform":{"boardModel":"Support Test Board"}}' ;;
  'health --json') echo '{"schemaVersion":1,"status":"healthy"}' ;;
  *) echo "unexpected orca arguments: $*" >&2; exit 2 ;;
esac
EOF

cat > "$fake_bin/journalctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'normal Orca service log\n'
printf 'Authorization: Bearer LOG_TOKEN_SENTINEL_DO_NOT_ARCHIVE\n'
cat <<'KEY'
-----BEGIN OPENSSH PRIVATE KEY-----
LOG_PRIVATE_KEY_SENTINEL_DO_NOT_ARCHIVE
-----END OPENSSH PRIVATE KEY-----
KEY
exit 7
EOF

cat > "$fake_bin/date" <<'EOF'
#!/usr/bin/env bash
printf '20260812T121500Z\n'
EOF

cat > "$fake_bin/hostname" <<'EOF'
#!/usr/bin/env bash
printf 'support-test-node\n'
EOF
cat > "$fake_bin/resource-report" <<'EOF'
#!/usr/bin/env bash
printf '{"schemaVersion":1,"memory":{"totalKiB":65536}}\n'
EOF
chmod +x "$fake_bin/orca" "$fake_bin/journalctl" "$fake_bin/date" "$fake_bin/hostname" "$fake_bin/resource-report"

archive="$temp_dir/support.tar.gz"
EXPECTED_ORCA_ROOT="$fake_root" \
ORCA_ROOT="$fake_root" \
ORCA_CLI_CMD="$fake_bin/orca" \
ORCA_JOURNALCTL_CMD="$fake_bin/journalctl" \
ORCA_DATE_CMD="$fake_bin/date" \
ORCA_HOSTNAME_CMD="$fake_bin/hostname" \
ORCA_RESOURCE_REPORT_CMD="$fake_bin/resource-report" \
ORCA_TAR_CMD="$(command -v tar)" \
ORCA_TIMEOUT_CMD="$(command -v timeout)" \
ORCA_HEAD_CMD="$(command -v head)" \
ORCA_SUPPORT_MAX_BYTES=4096 \
  "$bundle_script" "$archive" >/dev/null

[[ -f "$archive" ]]
[[ "$(stat -c '%a' "$archive")" == 600 ]]

listing="$(tar -tzf "$archive")"
for expected in \
  metadata.txt release.txt node.txt info.txt doctor.txt services.txt network.txt platform.txt health.txt resources.txt \
  logs/orca-agent.txt logs/orca-api.txt; do
  grep -qx "orca-support-20260812T121500Z/$expected" <<<"$listing"
done
if grep -Eq 'api-token|\.ssh|id_ed25519|environment|environ' <<<"$listing"; then
  echo "support bundle contains a forbidden path" >&2
  exit 1
fi

tar -xzf "$archive" -C "$temp_dir/extracted"
payload="$temp_dir/extracted/orca-support-20260812T121500Z"
grep -q 'ORCA_VERSION=0.1.0-test' "$payload/release.txt"
grep -q 'support-test-node' "$payload/node.txt"
grep -q 'Support Test Board' "$payload/platform.txt"
grep -q '"totalKiB":65536' "$payload/resources.txt"
grep -q 'normal Orca service log' "$payload/logs/orca-agent.txt"
grep -q '\[REDACTED SENSITIVE LINE\]' "$payload/logs/orca-agent.txt"
grep -q '\[REDACTED PRIVATE KEY BLOCK\]' "$payload/logs/orca-agent.txt"
grep -q 'exited with status 7' "$payload/logs/orca-agent.txt"

if grep -R -E 'ORCA_API_TOKEN_SENTINEL|SSH_PRIVATE_KEY_SENTINEL|LOG_TOKEN_SENTINEL|LOG_PRIVATE_KEY_SENTINEL' "$payload"; then
  echo "support bundle leaked sentinel secret material" >&2
  exit 1
fi

while IFS= read -r file; do
  (( $(stat -c '%s' "$file") <= 4300 )) || {
    echo "support bundle section exceeded its configured bound: $file" >&2
    exit 1
  }
done < <(find "$payload" -type f -print)

default_dir="$temp_dir/default-output"
mkdir -p "$default_dir"
(
  cd "$default_dir"
  EXPECTED_ORCA_ROOT="$fake_root" \
  ORCA_ROOT="$fake_root" \
  ORCA_CLI_CMD="$fake_bin/orca" \
  ORCA_JOURNALCTL_CMD="$fake_bin/journalctl" \
  ORCA_DATE_CMD="$fake_bin/date" \
  ORCA_HOSTNAME_CMD="$fake_bin/hostname" \
  ORCA_RESOURCE_REPORT_CMD="$fake_bin/resource-report" \
    "$bundle_script" >/dev/null
)
[[ -f "$default_dir/orca-support-20260812T121500Z.tar.gz" ]]
[[ "$(stat -c '%a' "$default_dir/orca-support-20260812T121500Z.tar.gz")" == 600 ]]

echo "Support bundle tests passed."
