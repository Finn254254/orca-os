# @orca/mesh

The communication layer between Orca Agents and Orca Control.

- `protocol.ts` — encode/decode + zod-validate mesh messages.
- `server.ts` — `MeshServer`: attaches a `ws` WebSocketServer to an existing
  HTTP server, authenticates connections via a shared cluster token on
  `hello`, emits `hello`/`heartbeat`/`commandResult`/`disconnect` events, and
  exposes `sendCommand`/`isConnected`/`connectedNodeIds`. `close()` closes
  every open socket and waits for their disconnect handlers to run before
  resolving, so callers can safely persist final state right after.
- `client.ts` — `MeshClient`: connects, sends `hello`, automatically
  reconnects with exponential backoff + jitter on disconnect, exposes
  `sendHeartbeat`/`sendCommandResult` and `command`/`ack`/`open`/`close`
  events.

This is intentionally a small, explicit protocol (not a generic RPC
framework) — see the build instructions' guidance to build a reliable MVP
rather than distributed consensus machinery.

Run tests: `npx vitest run --root mesh` (from `orca-platform/`).
