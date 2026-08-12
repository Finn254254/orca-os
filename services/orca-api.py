#!/usr/bin/env python3
"""Local read-only management API for an Orca node."""

import argparse
import json
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class OrcaHandler(BaseHTTPRequestHandler):
    runtime_dir: Path
    state_dir: Path
    node_id_pattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    endpoint_pattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.:-]{0,255}$")

    def send_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def node_record(self) -> dict | None:
        try:
            payload = json.loads((self.runtime_dir / "node.json").read_text())
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return None
        return payload if isinstance(payload, dict) else None

    def peers(self) -> list[dict]:
        peers = []
        for peer_file in sorted((self.state_dir / "peers").glob("*.json")):
            try:
                peer = json.loads(peer_file.read_text())
            except (OSError, json.JSONDecodeError):
                continue
            if (
                isinstance(peer, dict)
                and peer.get("schemaVersion") == 1
                and isinstance(peer.get("nodeId"), str)
                and isinstance(peer.get("endpoint"), str)
                and self.node_id_pattern.fullmatch(peer["nodeId"])
                and self.endpoint_pattern.fullmatch(peer["endpoint"])
            ):
                peers.append(peer)
        return peers

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self.send_json(HTTPStatus.OK, {"status": "ok"})
            return
        if self.path == "/v1/node":
            payload = self.node_record()
            if payload is None:
                self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"agent": "inactive"})
                return
            self.send_json(HTTPStatus.OK, payload)
            return
        if self.path == "/v1/peers":
            self.send_json(HTTPStatus.OK, {"schemaVersion": 1, "peers": self.peers()})
            return
        if self.path == "/v1/status":
            node = self.node_record()
            self.send_json(
                HTTPStatus.OK,
                {
                    "schemaVersion": 1,
                    "agent": "active" if node else "inactive",
                    "nodeId": node.get("nodeId") if node else None,
                    "peerCount": len(self.peers()),
                },
            )
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def log_message(self, _format: str, *_args: object) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="Orca local management API")
    parser.add_argument("--runtime-dir", default="/run/orca")
    parser.add_argument("--state-dir", default="/var/lib/orca")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=9876, type=int)
    args = parser.parse_args()
    OrcaHandler.runtime_dir = Path(args.runtime_dir)
    OrcaHandler.state_dir = Path(args.state_dir)
    ThreadingHTTPServer((args.host, args.port), OrcaHandler).serve_forever()


if __name__ == "__main__":
    main()
