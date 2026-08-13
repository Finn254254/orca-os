#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for test_file in "$project_root"/tests/test_*.sh; do
  echo "Running ${test_file##*/}"
  bash "$test_file"
done

python3 "$project_root/tests/test_api.py"
python3 "$project_root/tests/test_token_init.py"

echo "All Orca OS tests passed."
