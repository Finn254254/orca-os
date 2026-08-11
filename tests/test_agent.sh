#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_root="$(mktemp -d)"
agent_pid=""
cleanup() {
  [[ -z "$agent_pid" ]] || kill "$agent_pid" 2>/dev/null || true
  [[ -z "$agent_pid" ]] || wait "$agent_pid" 2>/dev/null || true
  rm -rf "$temp_root"
}
trap cleanup EXIT

ORCA_RUNTIME_DIR="$temp_root/run" \
ORCA_STATE_DIR="$temp_root/state" \
ORCA_NODE_ID="test-node-123" \
ORCA_AGENT_INTERVAL=60 \
  "$project_root/services/orca-agent" &
agent_pid=$!

for _ in {1..20}; do
  [[ -f "$temp_root/run/node.json" ]] && break
  sleep 0.1
done

grep -q 'Node ID: test-node-123' "$temp_root/run/agent.status"
grep -q '"nodeId":"test-node-123"' "$temp_root/run/node.json"
grep -q '"pid":' "$temp_root/run/node.json"
kill "$agent_pid"
wait "$agent_pid" || true
agent_pid=""
test ! -e "$temp_root/run/agent.status"
test ! -e "$temp_root/run/node.json"
