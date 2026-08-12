#!/usr/bin/env python3
import json
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TOKEN = "orca-test-token-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ"


with tempfile.TemporaryDirectory() as temp:
    runtime = Path(temp) / "run"
    state = Path(temp) / "state"
    token_file = state / "api-token"
    runtime.mkdir()
    (state / "peers").mkdir(parents=True)
    token_file.write_text(f"{TOKEN}\n")
    token_file.chmod(0o600)
    (runtime / "node.json").write_text(json.dumps({
        "schemaVersion": 1,
        "nodeId": "test-node",
        "agent": "active",
        "architecture": "x86_64",
        "kernel": "test-kernel",
        "updated": "2026-08-12T10:00:00Z",
        "resources": {
            "cpu": {"cores": 4, "model": "Test CPU"},
            "memory": {"totalMiB": 4096, "availableMiB": 3072},
            "storage": {"rootTotalMiB": 8192, "rootAvailableMiB": 6144},
            "virtualization": "kvm",
            "cpuCores": 4,
            "memoryMiB": 4096,
        },
        "health": {"uptimeSeconds": 120, "load1m": 0.25, "status": "healthy", "warnings": []},
        "platform": {
            "boardModel": "Test Board",
            "boardSerial": "TEST123",
            "compatible": ["test,board"],
            "firmware": "uefi",
            "networkInterfaces": [{"name": "eth0", "macAddress": "02:00:00:00:00:01", "state": "up", "carrier": True}],
            "thermalZones": [{"name": "thermal_zone0", "type": "cpu", "celsius": 42.5}],
        },
    }))
    (state / "peers" / "peer-a.json").write_text('{"schemaVersion":1,"nodeId":"peer-a","endpoint":"10.0.0.2:9876"}')
    (state / "peers" / "bad.json").write_text('{not json}')
    (state / "peers" / "bad-shape.json").write_text('{"nodeId":"bad/node","endpoint":"https://wrong"}')
    (state / "peers" / "old-schema.json").write_text('{"nodeId":"old-peer","endpoint":"10.0.0.8:9876"}')
    port = 19876

    def request(path, token=None, data=None):
        headers = {}
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        api_request = urllib.request.Request(
            f"http://127.0.0.1:{port}{path}",
            headers=headers,
            data=data,
            method="GET",
        )
        try:
            with urllib.request.urlopen(api_request) as response:
                return response.status, response.headers, json.load(response)
        except urllib.error.HTTPError as error:
            with error:
                return error.code, error.headers, json.load(error)

    def authorized(path):
        status, _headers, payload = request(path, TOKEN)
        assert status == 200, (status, payload)
        return payload

    process = subprocess.Popen(
        [
            "python3", str(ROOT / "services/orca-api.py"), "--runtime-dir", str(runtime),
            "--state-dir", str(state), "--token-file", str(token_file), "--port", str(port),
        ]
    )
    try:
        for _ in range(30):
            try:
                status, _headers, payload = request("/healthz")
                assert status == 200
                assert payload == {"status": "ok"}
                break
            except OSError:
                time.sleep(0.1)
        else:
            raise AssertionError("API did not start")

        # Liveness is deliberately public and query strings do not change routing.
        status, _headers, payload = request("/healthz?probe=boot")
        assert status == 200
        assert payload == {"status": "ok"}

        # Every management endpoint is authenticated before it is routed.
        status, headers, payload = request("/v1/node")
        assert status == 401
        assert headers["WWW-Authenticate"] == 'Bearer realm="orca"'
        assert payload == {"error": "unauthorized"}
        status, headers, payload = request("/v1/node", "wrong-token-value-that-is-long-enough")
        assert status == 401
        assert headers["WWW-Authenticate"] == 'Bearer realm="orca"'
        assert payload == {"error": "unauthorized"}
        status, _headers, payload = request("/v1/not-an-endpoint?ignored=yes")
        assert status == 401
        assert payload == {"error": "unauthorized"}
        status, _headers, payload = request("/v1/not-an-endpoint?ignored=yes", TOKEN)
        assert status == 404
        assert payload == {"error": "not found"}
        post_request = urllib.request.Request(
            f"http://127.0.0.1:{port}/v1/status", data=b"", method="POST"
        )
        try:
            urllib.request.urlopen(post_request)
        except urllib.error.HTTPError as error:
            assert error.code == 401
            assert error.headers["WWW-Authenticate"] == 'Bearer realm="orca"'
        else:
            raise AssertionError("unauthenticated POST to /v1/status was not rejected")

        assert authorized("/v1/node?detail=full")["nodeId"] == "test-node"
        hardware = authorized("/v1/hardware")
        assert hardware["architecture"] == "x86_64"
        assert hardware["resources"]["cpu"] == {"cores": 4, "model": "Test CPU"}
        assert authorized("/v1/health") == {
            "schemaVersion": 1,
            "status": "healthy",
            "agent": "active",
            "uptimeSeconds": 120,
            "load1m": 0.25,
            "warnings": [],
            "updated": "2026-08-12T10:00:00Z",
        }
        platform = authorized("/v1/platform")
        assert platform["platform"]["boardModel"] == "Test Board"
        assert platform["platform"]["networkInterfaces"][0]["name"] == "eth0"
        assert authorized("/v1/peers") == {
            "schemaVersion": 1,
            "peers": [{"schemaVersion": 1, "nodeId": "peer-a", "endpoint": "10.0.0.2:9876"}],
        }
        assert authorized("/v1/nodes") == {
            "schemaVersion": 1,
            "nodes": [
                {
                    "nodeId": "test-node",
                    "hostname": None,
                    "architecture": "x86_64",
                    "role": "local",
                    "status": "active",
                },
                {
                    "nodeId": "peer-a",
                    "endpoint": "10.0.0.2:9876",
                    "role": "peer",
                    "status": "enrolled",
                },
            ],
        }
        assert authorized("/v1/status?format=json") == {
            "schemaVersion": 1,
            "agent": "active",
            "nodeId": "test-node",
            "peerCount": 1,
        }

        # GET bodies are rejected instead of being left unread on a keep-alive connection.
        status, _headers, payload = request("/v1/status", TOKEN, data=b"unexpected")
        assert status == 400
        assert payload == {"error": "request bodies are not supported"}

        (runtime / "node.json").unlink()
        assert authorized("/v1/status") == {
            "schemaVersion": 1,
            "agent": "inactive",
            "nodeId": None,
            "peerCount": 1,
        }

        # A missing or malformed credential is a configuration failure, not an auth guess.
        token_file.unlink()
        status, headers, payload = request("/v1/status", TOKEN)
        assert status == 503
        assert headers["Retry-After"] == "5"
        assert payload == {"error": "API token unavailable"}
        status, _headers, payload = request("/healthz")
        assert status == 200
        assert payload == {"status": "ok"}

        # Header limits are enforced before the stdlib parser can allocate its
        # much larger default bounds.
        with socket.create_connection(("127.0.0.1", port), timeout=2) as client:
            client.sendall(b"GET /healthz HTTP/1.1\r\nX-Large: " + b"a" * 17000 + b"\r\n\r\n")
            response = client.recv(4096)
        assert b" 431 " in response
        token_file.write_text("short\n")
        status, _headers, payload = request("/v1/status", TOKEN)
        assert status == 503
        assert payload == {"error": "API token unavailable"}
    finally:
        process.terminate()
        process.wait(timeout=5)
