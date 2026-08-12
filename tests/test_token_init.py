#!/usr/bin/env python3
"""Tests for persistent Orca API token initialization."""

import os
import stat
import subprocess
import tempfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
INITIALIZER = PROJECT_ROOT / "services" / "orca-token-init"


def run(path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(INITIALIZER), str(path)],
        check=False,
        capture_output=True,
        text=True,
    )


with tempfile.TemporaryDirectory() as directory:
    token_file = Path(directory) / "state" / "api-token"
    first = run(token_file)
    assert first.returncode == 0, first.stderr
    token = token_file.read_text(encoding="ascii").strip()
    assert len(token) == 64
    assert set(token) <= set("0123456789abcdef")
    assert stat.S_IMODE(token_file.stat().st_mode) == 0o640

    second = run(token_file)
    assert second.returncode == 0, second.stderr
    assert token_file.read_text(encoding="ascii").strip() == token

    os.chmod(token_file, 0o644)
    repaired = run(token_file)
    assert repaired.returncode == 0, repaired.stderr
    assert stat.S_IMODE(token_file.stat().st_mode) == 0o640

    rotated = subprocess.run(
        ["python3", str(INITIALIZER), "--rotate", str(token_file)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert rotated.returncode == 0, rotated.stderr
    rotated_token = token_file.read_text(encoding="ascii").strip()
    assert len(rotated_token) == 64
    assert rotated_token != token
    assert stat.S_IMODE(token_file.stat().st_mode) == 0o640

    token_file.write_text("not-a-valid-token\n", encoding="ascii")
    invalid = run(token_file)
    assert invalid.returncode != 0
    assert "invalid Orca API token" in invalid.stderr
    assert token_file.read_text(encoding="ascii") == "not-a-valid-token\n"

    token_file.unlink()
    symlink_target = Path(directory) / "must-not-change"
    symlink_target.write_text("safe\n", encoding="ascii")
    token_file.symlink_to(symlink_target)
    refused_symlink = run(token_file)
    assert refused_symlink.returncode != 0
    assert symlink_target.read_text(encoding="ascii") == "safe\n"

print("Orca token initialization tests passed.")
