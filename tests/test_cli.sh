#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_root="$(mktemp -d)"
trap 'rm -rf "$temp_root"' EXIT

mkdir -p "$temp_root/etc" "$temp_root/run/orca" "$temp_root/var/lib/orca" "$temp_root/usr/local/bin" "$temp_root/usr/lib/systemd/system" "$temp_root/etc/systemd/system/multi-user.target.wants" "$temp_root/bin"
cp "$project_root/config/etc/orca-release" "$temp_root/etc/orca-release"
cp "$project_root/cli/orca" "$temp_root/usr/local/bin/orca"
chmod +x "$temp_root/usr/local/bin/orca"
touch "$temp_root/usr/lib/systemd/system/orca-agent.service"
ln -s /usr/lib/systemd/system/orca-agent.service "$temp_root/etc/systemd/system/multi-user.target.wants/orca-agent.service"
cat > "$temp_root/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  is-active) echo active ;;
  restart) exit 0 ;;
  *) echo "mock service status: active" ;;
esac
EOF
cat > "$temp_root/bin/journalctl" <<'EOF'
#!/usr/bin/env bash
echo "mock journal for $*"
EOF
cat > "$temp_root/bin/ip" <<'EOF'
#!/usr/bin/env bash
if [[ " $* " == *" -j "* ]]; then
  printf '%s\n' '[{"ifname":"enp0s2","operstate":"UP","addr_info":[{"family":"inet","local":"10.0.2.15"}]}]'
else
  echo '2: enp0s2 inet 10.0.2.15/24 scope global enp0s2'
fi
EOF
cat > "$temp_root/bin/curl" <<'EOF'
#!/usr/bin/env bash
if [[ " $* " == *" /v1/node "* || " $* " == *"/v1/node"* ]]; then
  printf '{"nodeId":"%s"}\n' "${ORCA_TEST_PEER_ID:-peer-one}"
else
  echo '{"status":"ok"}'
fi
EOF
cat > "$temp_root/bin/hostnamectl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$ORCA_TEST_HOSTNAME_LOG"
EOF
cat > "$temp_root/bin/support-bundle" <<'EOF'
#!/usr/bin/env bash
echo "${1:-orca-support-test.tar.gz}"
EOF
cat > "$temp_root/bin/resource-report" <<'EOF'
#!/usr/bin/env bash
echo '{"schemaVersion":1,"memory":{"totalKiB":65536}}'
EOF
chmod +x "$temp_root/bin/"*
test_env=(ORCA_ROOT="$temp_root" ORCA_SYSTEMCTL="$temp_root/bin/systemctl" ORCA_JOURNALCTL="$temp_root/bin/journalctl" ORCA_IP="$temp_root/bin/ip" ORCA_CURL="$temp_root/bin/curl" ORCA_HOSTNAMECTL="$temp_root/bin/hostnamectl" ORCA_TEST_HOSTNAME_LOG="$temp_root/hostnamectl.log" ORCA_TOKEN_INIT="$project_root/services/orca-token-init" ORCA_SUPPORT_BUNDLE="$temp_root/bin/support-bundle" ORCA_RESOURCE_REPORT="$temp_root/bin/resource-report" ORCA_API_GROUP="$(id -gn)")

info="$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" info)"
grep -q 'Name: Orca OS 0.1.0 (Tidepool)' <<<"$info"
grep -q 'Architecture:' <<<"$info"
grep -q 'CPU:' <<<"$info"
grep -q 'Memory MiB:' <<<"$info"
info_json="$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" info --json)"
python3 - "$info_json" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload["schemaVersion"] == 1
assert payload["name"] == "Orca OS 0.1.0 (Tidepool)"
assert payload["version"] == "0.1.0"
assert payload["architecture"]
assert payload["kernel"]
assert payload["cpu"]["model"]
assert isinstance(payload["cpu"]["cores"], int)
assert isinstance(payload["memoryMiB"], int)
PY
if ORCA_ROOT="$temp_root" "$project_root/cli/orca" info --unknown >/dev/null 2>&1; then
  echo 'info unexpectedly accepted an unknown option' >&2
  exit 1
fi

status="$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" status)"
grep -q 'Agent: inactive' <<<"$status"

printf 'Agent: active\nNode ID: test-node\n' > "$temp_root/run/orca/agent.status"
printf 'test-node\n' > "$temp_root/var/lib/orca/node-id"
printf '%064d\n' 0 > "$temp_root/var/lib/orca/api-token"
printf '%s\n' '{"schemaVersion":1,"nodeId":"test-node","agent":"active","architecture":"x86_64","kernel":"test-kernel","updated":"2026-08-12T10:00:00Z","resources":{"cpu":{"cores":4,"model":"Test CPU"},"memory":{"totalMiB":4096,"availableMiB":3072},"storage":{"rootTotalMiB":8192,"rootAvailableMiB":6144},"virtualization":"kvm","cpuCores":4,"memoryMiB":4096},"health":{"uptimeSeconds":120,"load1m":0.25,"status":"healthy","warnings":[]},"platform":{"boardModel":"Test Board","boardSerial":"TEST123","compatible":["test,board"],"firmware":"uefi","networkInterfaces":[{"name":"eth0","macAddress":"02:00:00:00:00:01","state":"up","carrier":true}],"thermalZones":[{"name":"thermal_zone0","type":"cpu","celsius":42.5}]}}' > "$temp_root/run/orca/node.json"
status="$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" status)"
grep -q 'Node ID: test-node' <<<"$status"
grep -q '"nodeId":"test-node"' <<<"$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" status --json)"
[[ "$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" node id)" == "test-node" ]]
grep -q '"agent":"active"' <<<"$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" node show)"
grep -q 'Node hostname changed to edge-one' <<<"$(env "${test_env[@]}" "$project_root/cli/orca" node rename edge-one)"
grep -q '^set-hostname edge-one$' "$temp_root/hostnamectl.log"
cat > "$temp_root/bin/hostnamectl-fail" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$temp_root/bin/hostnamectl-fail"
grep -q 'Node hostname changed to edge-two' <<<"$(env "${test_env[@]}" ORCA_HOSTNAMECTL="$temp_root/bin/hostnamectl-fail" "$project_root/cli/orca" node rename edge-two)"
[[ "$(cat "$temp_root/etc/hostname")" == edge-two ]]
if env "${test_env[@]}" "$project_root/cli/orca" node rename 'bad_name' >/dev/null 2>&1; then
  echo 'node rename accepted an invalid hostname' >&2
  exit 1
fi
old_token="$(env "${test_env[@]}" "$project_root/cli/orca" api token)"
grep -Eq '^[0-9a-f]{64}$' <<<"$old_token"
env "${test_env[@]}" "$project_root/cli/orca" api rotate-token >/dev/null
new_token="$(env "${test_env[@]}" "$project_root/cli/orca" api token)"
[[ "$old_token" != "$new_token" ]]
grep -q 'orca-support-test.tar.gz' <<<"$(env "${test_env[@]}" "$project_root/cli/orca" support)"
grep -q '"totalKiB":65536' <<<"$(env "${test_env[@]}" "$project_root/cli/orca" resources --json)"
hardware="$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" hardware)"
grep -q 'CPU: Test CPU' <<<"$hardware"
grep -q 'Memory: 3072 MiB available / 4096 MiB total' <<<"$hardware"
grep -q '"architecture":"x86_64"' <<<"$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" hardware --json)"
health="$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" health)"
grep -q 'Status: healthy' <<<"$health"
grep -q 'Load 1m: 0.25' <<<"$health"
grep -q '"uptimeSeconds":120' <<<"$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" health --json)"
if ORCA_ROOT="$temp_root" "$project_root/cli/orca" hardware --bad >/dev/null 2>&1; then
  echo 'hardware unexpectedly accepted an unknown option' >&2
  exit 1
fi
platform="$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" platform)"
grep -q 'Board Model: Test Board' <<<"$platform"
grep -q 'eth0.*02:00:00:00:00:01.*carrier' <<<"$platform"
grep -q 'cpu: 42.5 C' <<<"$platform"
grep -q '"firmware":"uefi"' <<<"$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" platform --json)"
grep -q 'Agent enabled: ok' <<<"$(env "${test_env[@]}" "$project_root/cli/orca" doctor)"
grep -q 'Overall: ok' <<<"$(env "${test_env[@]}" "$project_root/cli/orca" doctor)"
grep -q '"status":"ok"' <<<"$(env "${test_env[@]}" "$project_root/cli/orca" doctor --json)"
services="$(env "${test_env[@]}" "$project_root/cli/orca" services)"
grep -q 'orca-agent.*active' <<<"$services"
grep -q '"name":"orca-api","state":"active"' <<<"$(env "${test_env[@]}" "$project_root/cli/orca" services --json)"
grep -q 'mock service status: active' <<<"$(env "${test_env[@]}" "$project_root/cli/orca" service orca-api status)"
grep -q 'Restarted orca-api' <<<"$(env "${test_env[@]}" "$project_root/cli/orca" service orca-api restart)"
grep -q 'mock journal' <<<"$(env "${test_env[@]}" "$project_root/cli/orca" logs orca-api 25)"
grep -q '10.0.2.15' <<<"$(env "${test_env[@]}" "$project_root/cli/orca" network)"
grep -q '"name":"enp0s2"' <<<"$(env "${test_env[@]}" "$project_root/cli/orca" network --json)"
if env "${test_env[@]}" "$project_root/cli/orca" service ssh restart >/dev/null 2>&1; then
  echo 'service restart unexpectedly allowed restarting ssh' >&2
  exit 1
fi
if env "${test_env[@]}" "$project_root/cli/orca" logs orca-api 501 >/dev/null 2>&1; then
  echo 'logs unexpectedly accepted too many lines' >&2
  exit 1
fi
rm "$temp_root/usr/local/bin/orca"
if env "${test_env[@]}" "$project_root/cli/orca" doctor >/dev/null 2>&1; then
  echo 'doctor unexpectedly passed with a missing CLI' >&2
  exit 1
fi
cp "$project_root/cli/orca" "$temp_root/usr/local/bin/orca"
chmod +x "$temp_root/usr/local/bin/orca"
printf '%s\n' '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' | env "${test_env[@]}" ORCA_TEST_PEER_ID=peer-one "$project_root/cli/orca" peer add peer-one 10.0.0.2:9876 --token-stdin >/dev/null
grep -q '"nodeId":"peer-one"' <<<"$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" peer list)"
! grep -q '0123456789abcdef' <<<"$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" peer list)"
grep -q '"endpoint":"10.0.0.2:9876"' <<<"$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" peer show peer-one)"
grep -q 'Peer reachable: peer-one' <<<"$(env "${test_env[@]}" ORCA_TEST_PEER_ID=peer-one "$project_root/cli/orca" peer check peer-one)"
nodes="$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" nodes)"
grep -q 'test-node  local  active' <<<"$nodes"
grep -q 'peer-one  peer  enrolled  10.0.0.2:9876' <<<"$nodes"
nodes_json="$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" nodes --json)"
grep -q '"role":"local"' <<<"$nodes_json"
grep -q '"role":"peer"' <<<"$nodes_json"
ORCA_ROOT="$temp_root" "$project_root/cli/orca" peer remove peer-one >/dev/null
test ! -e "$temp_root/var/lib/orca/peer-tokens/peer-one"
grep -q 'No enrolled peers.' <<<"$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" peer list)"
if ORCA_ROOT="$temp_root" "$project_root/cli/orca" peer show peer-one >/dev/null 2>&1; then
  echo 'peer show unexpectedly found a removed peer' >&2
  exit 1
fi
if printf '%s\n' '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' | ORCA_ROOT="$temp_root" "$project_root/cli/orca" peer add peer-bad missing-port --token-stdin >/dev/null 2>&1; then
  echo 'peer add accepted an endpoint without a port' >&2
  exit 1
fi
if ORCA_ROOT="$temp_root" "$project_root/cli/orca" peer add peer-bad 10.0.0.2:9876 >/dev/null 2>&1; then
  echo 'peer add accepted enrollment without a credential' >&2
  exit 1
fi

[[ "$(ORCA_ROOT="$temp_root" "$project_root/cli/orca" version)" == "0.1.0" ]]

if ORCA_ROOT="$temp_root" "$project_root/cli/orca" unknown >/dev/null 2>&1; then
  echo 'unknown command unexpectedly succeeded' >&2
  exit 1
fi
