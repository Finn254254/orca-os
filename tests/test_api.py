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
    state = Path(temp) / "state"
    runtime.mkdir()
    (state / "peers").mkdir(parents=True)
    (runtime / "node.json").write_text('{"nodeId":"test-node","agent":"active"}')
    (state / "peers" / "peer-a.json").write_text('{"schemaVersion":1,"nodeId":"peer-a","endpoint":"10.0.0.2:9876"}')
    (state / "peers" / "bad.json").write_text('{not json}')
    (state / "peers" / "bad-shape.json").write_text('{"nodeId":"bad/node","endpoint":"https://wrong"}')
    (state / "peers" / "old-schema.json").write_text('{"nodeId":"old-peer","endpoint":"10.0.0.8:9876"}')
    port = 19876
    process = subprocess.Popen(
        [
            "python3", str(ROOT / "services/orca-api.py"), "--runtime-dir", str(runtime),
            "--state-dir", str(state), "--port", str(port),
        ]
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
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/v1/peers") as response:
            assert json.load(response) == {
                "schemaVersion": 1,
                "peers": [{"schemaVersion": 1, "nodeId": "peer-a", "endpoint": "10.0.0.2:9876"}],
            }
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/v1/status") as response:
            assert json.load(response) == {
                "schemaVersion": 1,
                "agent": "active",
                "nodeId": "test-node",
                "peerCount": 1,
            }
        (runtime / "node.json").unlink()
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/v1/status") as response:
            assert json.load(response) == {
                "schemaVersion": 1,
                "agent": "inactive",
                "nodeId": None,
                "peerCount": 1,
            }
    finally:
        process.terminate()
        process.wait(timeout=5)
