#!/usr/bin/env bash
set -euo pipefail

proc_root="${ORCA_PROC_ROOT:-/proc}"
sys_root="${ORCA_SYS_ROOT:-/sys}"
uname_cmd="${ORCA_UNAME_CMD:-uname}"
systemctl_cmd="${ORCA_SYSTEMCTL_CMD:-systemctl}"
stat_cmd="${ORCA_STAT_CMD:-stat}"
image_path="${ORCA_IMAGE:-}"
initrd_path="${ORCA_INITRD:-}"

usage() {
  cat <<'EOF'
Usage: resource-report.sh [--image PATH] [--initrd PATH]

Print a compact JSON resource report. Tests and offline inspection may override
ORCA_PROC_ROOT, ORCA_SYS_ROOT, ORCA_UNAME_CMD, ORCA_SYSTEMCTL_CMD, and
ORCA_STAT_CMD.
EOF
}

while (($#)); do
  case "$1" in
    --image)
      [[ $# -ge 2 ]] || { echo "--image requires a path" >&2; exit 2; }
      image_path="$2"
      shift 2
      ;;
    --initrd)
      [[ $# -ge 2 ]] || { echo "--initrd requires a path" >&2; exit 2; }
      initrd_path="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

json_string() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '"%s"' "$value"
}

json_uint() {
  if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
    printf '%s' "$1"
  else
    printf 'null'
  fi
}

meminfo_value() {
  local key="$1"
  [[ -r "$proc_root/meminfo" ]] || return 0
  awk -v key="$key:" '$1 == key && $2 ~ /^[0-9]+$/ { print $2; exit }' "$proc_root/meminfo"
}

memory_total_kib="$(meminfo_value MemTotal)"
memory_available_kib="$(meminfo_value MemAvailable)"
if [[ -z "$memory_available_kib" && -r "$proc_root/meminfo" ]]; then
  memory_available_kib="$(
    awk '
      $1 == "MemFree:" { free = $2 }
      $1 == "Buffers:" { buffers = $2 }
      $1 == "Cached:" { cached = $2 }
      END {
        if (free ~ /^[0-9]+$/ && buffers ~ /^[0-9]+$/ && cached ~ /^[0-9]+$/)
          print free + buffers + cached
      }
    ' "$proc_root/meminfo"
  )"
fi

architecture="$($uname_cmd -m 2>/dev/null || true)"
[[ -n "$architecture" ]] || architecture="unknown"

process_count=0
shopt -s nullglob
for process_dir in "$proc_root"/[0-9]*; do
  [[ -d "$process_dir" && "${process_dir##*/}" =~ ^[0-9]+$ ]] || continue
  ((process_count += 1))
done
shopt -u nullglob

artifact_json() {
  local path="$1" size
  if [[ -z "$path" ]]; then
    printf '{"path":null,"sizeBytes":null}'
    return
  fi
  [[ -f "$path" ]] || { echo "Artifact not found: $path" >&2; return 1; }
  size="$($stat_cmd -c '%s' -- "$path")"
  [[ "$size" =~ ^[0-9]+$ ]] || { echo "Could not determine artifact size: $path" >&2; return 1; }
  printf '{"path":%s,"sizeBytes":%s}' "$(json_string "$path")" "$size"
}

service_pid() {
  local service="$1" configured_pid="" pid=""
  case "$service" in
    orca-agent) configured_pid="${ORCA_AGENT_PID:-}" ;;
    orca-api) configured_pid="${ORCA_API_PID:-}" ;;
  esac
  if [[ -n "$configured_pid" ]]; then
    pid="$configured_pid"
  else
    pid="$($systemctl_cmd show --property=MainPID --value "$service.service" 2>/dev/null || true)"
  fi
  if [[ "$pid" =~ ^[0-9]+$ && "$pid" != 0 && -d "$proc_root/$pid" ]]; then
    printf '%s' "$pid"
  fi
}

process_kib() {
  local pid="$1" field="$2" source
  case "$field" in
    VmRSS) source="$proc_root/$pid/status" ;;
    Pss) source="$proc_root/$pid/smaps_rollup" ;;
    *) return 2 ;;
  esac
  [[ -r "$source" ]] || return 0
  awk -v field="$field:" '$1 == field && $2 ~ /^[0-9]+$/ { print $2; exit }' "$source"
}

cgroup_memory_current() {
  local service="$1" source="$sys_root/fs/cgroup/system.slice/$service.service/memory.current" value
  [[ -r "$source" ]] || return 0
  value="$(tr -d '[:space:]' < "$source")"
  [[ "$value" =~ ^[0-9]+$ ]] && printf '%s' "$value"
}

service_json() {
  local service="$1" pid rss pss cgroup_memory
  pid="$(service_pid "$service")"
  rss=""
  pss=""
  if [[ -n "$pid" ]]; then
    rss="$(process_kib "$pid" VmRSS)"
    pss="$(process_kib "$pid" Pss)"
  fi
  cgroup_memory="$(cgroup_memory_current "$service")"
  printf '{"name":%s,"pid":%s,"rssKiB":%s,"pssKiB":%s,"cgroupMemoryCurrentBytes":%s}' \
    "$(json_string "$service")" \
    "$(json_uint "$pid")" \
    "$(json_uint "$rss")" \
    "$(json_uint "$pss")" \
    "$(json_uint "$cgroup_memory")"
}

printf '{"schemaVersion":1,"architecture":%s,"memory":{"totalKiB":%s,"availableKiB":%s},"processCount":%s,"artifacts":{"image":%s,"initrd":%s},"services":[%s,%s]}\n' \
  "$(json_string "$architecture")" \
  "$(json_uint "$memory_total_kib")" \
  "$(json_uint "$memory_available_kib")" \
  "$process_count" \
  "$(artifact_json "$image_path")" \
  "$(artifact_json "$initrd_path")" \
  "$(service_json orca-agent)" \
  "$(service_json orca-api)"
