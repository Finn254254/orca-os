#!/usr/bin/env python3
"""Local read-only management API for an Orca node."""

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class OrcaHandler(BaseHTTPRequestHandler):
    runtime_dir: Path

    def send_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self.send_json(HTTPStatus.OK, {"status": "ok"})
            return
        if self.path == "/v1/node":
            try:
                payload = json.loads((self.runtime_dir / "node.json").read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"agent": "inactive"})
                return
            self.send_json(HTTPStatus.OK, payload)
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def log_message(self, _format: str, *_args: object) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="Orca local management API")
    parser.add_argument("--runtime-dir", default="/run/orca")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=9876, type=int)
    args = parser.parse_args()
    OrcaHandler.runtime_dir = Path(args.runtime_dir)
    ThreadingHTTPServer((args.host, args.port), OrcaHandler).serve_forever()


if __name__ == "__main__":
    main()
