#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_root="$(mktemp -d)"
trap 'rm -rf "$temp_root"' EXIT
cat > "$temp_root/fake-smoke" <<'EOF'
#!/usr/bin/env bash
printf '%s %s %s %s\n' "$ORCA_VM_MEMORY" "$ORCA_VM_CPUS" "$ORCA_VM_SSH_PORT" "$ORCA_VM_API_PORT"
EOF
chmod +x "$temp_root/fake-smoke"
output="$(ORCA_VM_SMOKE_SCRIPT="$temp_root/fake-smoke" ORCA_VM_LOWMEM_MEMORY=384 "$project_root/vm/smoke-test-lowmem-windows.sh")"
grep -q '384 2 2422 9978' <<<"$output"
default_output="$(ORCA_VM_SMOKE_SCRIPT="$temp_root/fake-smoke" "$project_root/vm/smoke-test-lowmem-windows.sh")"
grep -q '1536 2 2422 9978' <<<"$default_output"
if ORCA_VM_SMOKE_SCRIPT="$temp_root/fake-smoke" ORCA_VM_LOWMEM_MEMORY=64 "$project_root/vm/smoke-test-lowmem-windows.sh" >/dev/null 2>&1; then
  echo 'low-memory smoke wrapper accepted an unsupported memory size' >&2
  exit 1
fi
if ORCA_VM_SMOKE_SCRIPT="$temp_root/fake-smoke" ORCA_VM_LOWMEM_CPUS=0 "$project_root/vm/smoke-test-lowmem-windows.sh" >/dev/null 2>&1; then
  echo 'low-memory smoke wrapper accepted an unsupported CPU count' >&2
  exit 1
fi
echo 'Low-memory smoke wrapper tests passed.'
