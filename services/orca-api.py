#!/usr/bin/env python3
"""Small authenticated management API for an Orca node."""

import argparse
import http.client
import hmac
import json
import re
import socket
import time
from email.parser import BytesParser
from email.policy import HTTP
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class OrcaHTTPServer(HTTPServer):
    """A deliberately small, single-request-at-a-time HTTP server."""

    allow_reuse_address = True
    request_queue_size = 5


class OrcaHandler(BaseHTTPRequestHandler):
    server_version = "OrcaAPI/1"
    sys_version = ""
    runtime_dir: Path
    state_dir: Path
    token_file: Path
    request_timeout = 5.0
    max_request_line = 8 * 1024
    max_header_bytes = 16 * 1024
    max_header_count = 50
    max_token_bytes = 256
    node_id_pattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    endpoint_pattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.:-]{0,255}$")
    token_pattern = re.compile(rb"^[A-Za-z0-9._~-]{32,256}$")

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(self.request_timeout)
        self.request_deadline = time.monotonic() + self.request_timeout

    def _readline_with_deadline(self, limit: int) -> bytes:
        remaining = self.request_deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError
        self.connection.settimeout(remaining)
        return self.rfile.readline(limit)

    def parse_request(self) -> bool:
        self.command = None
        self.request_version = version = self.default_request_version
        self.close_connection = True
        requestline = self.raw_requestline.decode("iso-8859-1").rstrip("\r\n")
        self.requestline = requestline
        words = requestline.split()
        if not words:
            return False
        if len(words) >= 3:
            version = words[-1]
            try:
                if not version.startswith("HTTP/"):
                    raise ValueError
                components = version.split("/", 1)[1].split(".")
                if len(components) != 2 or any(not part.isdigit() or len(part) > 10 for part in components):
                    raise ValueError
                version_number = tuple(int(part) for part in components)
            except ValueError:
                self.send_error(HTTPStatus.BAD_REQUEST, f"Bad request version ({version!r})")
                return False
            if version_number >= (2, 0):
                self.send_error(HTTPStatus.HTTP_VERSION_NOT_SUPPORTED, f"Invalid HTTP version ({version})")
                return False
            if version_number >= (1, 1) and self.protocol_version >= "HTTP/1.1":
                self.close_connection = False
            self.request_version = version
        if not 2 <= len(words) <= 3:
            self.send_error(HTTPStatus.BAD_REQUEST, f"Bad request syntax ({requestline!r})")
            return False
        command, path = words[:2]
        if len(words) == 2:
            self.close_connection = True
            if command != "GET":
                self.send_error(HTTPStatus.BAD_REQUEST, f"Bad HTTP/0.9 request type ({command!r})")
                return False
        self.command, self.path = command, path
        if self.path.startswith("//"):
            self.path = "/" + self.path.lstrip("/")

        header_lines = []
        header_bytes = 0
        try:
            while True:
                remaining = self.max_header_bytes - header_bytes
                if remaining <= 0:
                    raise ValueError("request headers too large")
                line = self._readline_with_deadline(min(remaining + 1, 4097))
                if len(line) > 4096 or len(line) > remaining:
                    raise ValueError("request headers too large")
                header_bytes += len(line)
                header_lines.append(line)
                if len(header_lines) > self.max_header_count + 1:
                    raise ValueError("too many request headers")
                if line in (b"\r\n", b"\n", b""):
                    break
            self.headers = BytesParser(policy=HTTP, _class=self.MessageClass).parsebytes(
                b"".join(header_lines)
            )
        except (ValueError, http.client.HTTPException):
            self.close_connection = True
            self.send_json(
                HTTPStatus.REQUEST_HEADER_FIELDS_TOO_LARGE,
                {"error": "request headers too large"},
            )
            return False

        connection = self.headers.get("Connection", "").lower()
        if connection == "close":
            self.close_connection = True
        elif connection == "keep-alive" and self.protocol_version >= "HTTP/1.1":
            self.close_connection = False
        expect = self.headers.get("Expect", "")
        if (
            expect.lower() == "100-continue"
            and self.protocol_version >= "HTTP/1.1"
            and self.request_version >= "HTTP/1.1"
            and not self.handle_expect_100()
        ):
            return False
        return True

    def handle_one_request(self) -> None:
        """Apply tighter limits than BaseHTTPRequestHandler before dispatch."""
        try:
            self.request_deadline = time.monotonic() + self.request_timeout
            self.raw_requestline = self._readline_with_deadline(self.max_request_line + 1)
            if len(self.raw_requestline) > self.max_request_line:
                self.requestline = ""
                self.request_version = ""
                self.command = ""
                self.send_error(HTTPStatus.REQUEST_URI_TOO_LONG)
                return
            if not self.raw_requestline:
                self.close_connection = True
                return
            if not self.parse_request():
                return
            method = getattr(self, f"do_{self.command}", None)
            if method is None:
                self.send_error(HTTPStatus.NOT_IMPLEMENTED, f"Unsupported method ({self.command!r})")
                return
            method()
            self.wfile.flush()
        except (TimeoutError, socket.timeout):
            self.close_connection = True

    def send_json(
        self,
        status: HTTPStatus,
        payload: dict,
        headers: dict[str, str] | None = None,
    ) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def reject_request_body(self) -> bool:
        if self.headers.get("Transfer-Encoding") is not None:
            self.close_connection = True
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "request bodies are not supported"})
            return True
        content_lengths = self.headers.get_all("Content-Length", [])
        if len(content_lengths) > 1:
            self.close_connection = True
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid content length"})
            return True
        if content_lengths:
            try:
                content_length = int(content_lengths[0], 10)
            except ValueError:
                content_length = -1
            if content_length != 0:
                self.close_connection = True
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "request bodies are not supported"})
                return True
        return False

    def read_api_token(self) -> bytes | None:
        try:
            with self.token_file.open("rb") as token_stream:
                token = token_stream.read(self.max_token_bytes + 2)
        except OSError:
            return None
        if token.endswith(b"\n"):
            token = token[:-1]
            if token.endswith(b"\r"):
                token = token[:-1]
        if not self.token_pattern.fullmatch(token):
            return None
        return token

    def authorize_api_request(self) -> bool:
        expected = self.read_api_token()
        if expected is None:
            self.send_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"error": "API token unavailable"},
                {"Retry-After": "5"},
            )
            return False

        authorization = self.headers.get_all("Authorization", [])
        candidate = b""
        if len(authorization) == 1:
            scheme, separator, value = authorization[0].partition(" ")
            if separator and scheme.lower() == "bearer":
                candidate = value.encode("utf-8", errors="surrogatepass")
        if not hmac.compare_digest(candidate, expected):
            self.send_json(
                HTTPStatus.UNAUTHORIZED,
                {"error": "unauthorized"},
                {"WWW-Authenticate": 'Bearer realm="orca"'},
            )
            return False
        return True

    def handle_expect_100(self) -> bool:
        self.close_connection = True
        self.send_json(HTTPStatus.EXPECTATION_FAILED, {"error": "request bodies are not supported"})
        return False

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
        if self.reject_request_body():
            return

        path = urlsplit(self.path).path
        if path == "/healthz":
            self.send_json(HTTPStatus.OK, {"status": "ok"})
            return
        if path == "/v1" or path.startswith("/v1/"):
            if not self.authorize_api_request():
                return

        if path == "/v1/node":
            payload = self.node_record()
            if payload is None:
                self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"agent": "inactive"})
                return
            self.send_json(HTTPStatus.OK, payload)
            return
        if path in {"/v1/hardware", "/v1/health", "/v1/platform"}:
            node = self.node_record()
            if node is None:
                self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"agent": "inactive"})
                return
            if path == "/v1/hardware":
                self.send_json(
                    HTTPStatus.OK,
                    {
                        "schemaVersion": 1,
                        "architecture": node.get("architecture"),
                        "kernel": node.get("kernel"),
                        "resources": node.get("resources", {}),
                    },
                )
                return
            if path == "/v1/platform":
                self.send_json(
                    HTTPStatus.OK,
                    {"schemaVersion": 1, "platform": node.get("platform", {})},
                )
                return
            health = node.get("health", {})
            self.send_json(
                HTTPStatus.OK,
                {
                    "schemaVersion": 1,
                    "status": health.get("status", "healthy"),
                    "agent": "active",
                    "uptimeSeconds": health.get("uptimeSeconds"),
                    "load1m": health.get("load1m"),
                    "warnings": health.get("warnings", []),
                    "updated": node.get("updated"),
                },
            )
            return
        if path == "/v1/peers":
            self.send_json(HTTPStatus.OK, {"schemaVersion": 1, "peers": self.peers()})
            return
        if path == "/v1/nodes":
            node = self.node_record()
            nodes = []
            if node:
                nodes.append(
                    {
                        "nodeId": node.get("nodeId"),
                        "hostname": node.get("hostname"),
                        "architecture": node.get("architecture"),
                        "role": "local",
                        "status": "active",
                    }
                )
            nodes.extend(
                {
                    "nodeId": peer["nodeId"],
                    "endpoint": peer["endpoint"],
                    "role": "peer",
                    "status": "enrolled",
                }
                for peer in self.peers()
            )
            self.send_json(HTTPStatus.OK, {"schemaVersion": 1, "nodes": nodes})
            return
        if path == "/v1/status":
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

    def method_not_allowed(self) -> None:
        path = urlsplit(self.path).path
        if (path == "/v1" or path.startswith("/v1/")) and not self.authorize_api_request():
            return
        self.close_connection = True
        self.send_json(
            HTTPStatus.METHOD_NOT_ALLOWED,
            {"error": "method not allowed"},
            {"Allow": "GET"},
        )

    do_DELETE = method_not_allowed  # noqa: N815
    do_HEAD = method_not_allowed  # noqa: N815
    do_OPTIONS = method_not_allowed  # noqa: N815
    do_PATCH = method_not_allowed  # noqa: N815
    do_POST = method_not_allowed  # noqa: N815
    do_PUT = method_not_allowed  # noqa: N815

    def log_message(self, _format: str, *_args: object) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="Orca local management API")
    parser.add_argument("--runtime-dir", default="/run/orca")
    parser.add_argument("--state-dir", default="/var/lib/orca")
    parser.add_argument("--token-file", default="/var/lib/orca/api-token")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=9876, type=int)
    parser.add_argument("--request-timeout", default=5.0, type=float)
    args = parser.parse_args()
    if not 0 < args.request_timeout <= 60:
        parser.error("--request-timeout must be greater than 0 and no more than 60 seconds")
    OrcaHandler.runtime_dir = Path(args.runtime_dir)
    OrcaHandler.state_dir = Path(args.state_dir)
    OrcaHandler.token_file = Path(args.token_file)
    OrcaHandler.request_timeout = args.request_timeout
    OrcaHTTPServer((args.host, args.port), OrcaHandler).serve_forever()


if __name__ == "__main__":
    main()
