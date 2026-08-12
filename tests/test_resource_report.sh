#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
report="$project_root/tools/resource-report.sh"
temp_root="$(mktemp -d)"
cleanup() {
  [[ -n "${temp_root:-}" && -d "$temp_root" ]] || return 0
  rm -rf -- "${temp_root:?}"
}
trap cleanup EXIT

mkdir -p \
  "$temp_root/bin" \
  "$temp_root/proc/1" \
  "$temp_root/proc/101" \
  "$temp_root/proc/202" \
  "$temp_root/proc/not-a-process" \
  "$temp_root/sys/fs/cgroup/system.slice/orca-agent.service" \
  "$temp_root/sys/fs/cgroup/system.slice/orca-api.service"

cat > "$temp_root/proc/meminfo" <<'EOF'
MemTotal:       65536 kB
MemFree:         8192 kB
MemAvailable:   24576 kB
Buffers:         1024 kB
Cached:          4096 kB
EOF
cat > "$temp_root/proc/101/status" <<'EOF'
Name: orca-agent
VmRSS: 1234 kB
EOF
cat > "$temp_root/proc/101/smaps_rollup" <<'EOF'
Rss: 1234 kB
Pss: 1000 kB
EOF
cat > "$temp_root/proc/202/status" <<'EOF'
Name: orca-api
VmRSS: 2345 kB
EOF
printf '4096\n' > "$temp_root/sys/fs/cgroup/system.slice/orca-agent.service/memory.current"
printf '8192\n' > "$temp_root/sys/fs/cgroup/system.slice/orca-api.service/memory.current"

cat > "$temp_root/bin/uname" <<'EOF'
#!/usr/bin/env bash
[[ "${1:-}" == "-m" ]]
printf 'armv7l\n'
EOF
cat > "$temp_root/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
case "${*: -1}" in
  orca-agent.service) printf '101\n' ;;
  orca-api.service) printf '202\n' ;;
  *) printf '0\n' ;;
esac
EOF
chmod +x "$temp_root/bin/uname" "$temp_root/bin/systemctl"

printf 'image-data' > "$temp_root/orca.raw"
printf 'abc' > "$temp_root/orca.initrd"

run_report() {
  ORCA_PROC_ROOT="$temp_root/proc" \
  ORCA_SYS_ROOT="$temp_root/sys" \
  ORCA_UNAME_CMD="$temp_root/bin/uname" \
  ORCA_SYSTEMCTL_CMD="$temp_root/bin/systemctl" \
    "$report" --image "$temp_root/orca.raw" --initrd "$temp_root/orca.initrd"
}

first="$(run_report)"
second="$(run_report)"
[[ "$first" == "$second" ]] || { echo "resource report is not deterministic" >&2; exit 1; }

python3 - "$first" "$temp_root/orca.raw" "$temp_root/orca.initrd" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload["schemaVersion"] == 1
assert payload["architecture"] == "armv7l"
assert payload["memory"] == {"totalKiB": 65536, "availableKiB": 24576}
assert payload["processCount"] == 3
assert payload["artifacts"]["image"] == {"path": sys.argv[2], "sizeBytes": 10}
assert payload["artifacts"]["initrd"] == {"path": sys.argv[3], "sizeBytes": 3}
assert payload["services"] == [
    {
        "name": "orca-agent",
        "pid": 101,
        "rssKiB": 1234,
        "pssKiB": 1000,
        "cgroupMemoryCurrentBytes": 4096,
    },
    {
        "name": "orca-api",
        "pid": 202,
        "rssKiB": 2345,
        "pssKiB": None,
        "cgroupMemoryCurrentBytes": 8192,
    },
]
PY

without_artifacts="$(
  ORCA_PROC_ROOT="$temp_root/proc" \
  ORCA_SYS_ROOT="$temp_root/sys" \
  ORCA_UNAME_CMD="$temp_root/bin/uname" \
  ORCA_AGENT_PID=101 ORCA_API_PID=202 \
    "$report"
)"
python3 - "$without_artifacts" <<'PY'
import json
import sys

artifacts = json.loads(sys.argv[1])["artifacts"]
assert artifacts == {
    "image": {"path": None, "sizeBytes": None},
    "initrd": {"path": None, "sizeBytes": None},
}
PY

if "$report" --unknown >/dev/null 2>&1; then
  echo "unknown arguments must fail" >&2
  exit 1
fi

echo "resource report tests passed"
