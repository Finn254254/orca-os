#!/usr/bin/env python3
import json
import os
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


with tempfile.TemporaryDirectory() as temp:
    runtime = Path(temp) / "run"
    runtime.mkdir()
    (runtime / "node.json").write_text('{"nodeId":"test-node","agent":"active"}')
    port = 19876
    process = subprocess.Popen(
        ["python3", str(ROOT / "services/orca-api.py"), "--runtime-dir", str(runtime), "--port", str(port)]
    )
    try:
        for _ in range(30):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz") as response:
                    assert json.load(response) == {"status": "ok"}
                break
            except OSError:
                time.sleep(0.1)
        else:
            raise AssertionError("API did not start")
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/v1/node") as response:
            assert json.load(response)["nodeId"] == "test-node"
    finally:
        process.terminate()
        process.wait(timeout=5)
