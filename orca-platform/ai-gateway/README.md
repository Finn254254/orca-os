# @orca/ai-gateway

Orca AI Gateway: a unified inference API. Applications ask for a model by
name without needing to know which node/runtime hosts it. Mounted into
Orca API at `/api/v1/ai`.

## Why this was simple to build correctly

Both Ollama and llama.cpp's built-in server expose an OpenAI-compatible
`/v1/chat/completions` endpoint (a documented feature of each runtime) —
so routing is "look up which runtime this model belongs to (via
`@orca/models`' registry), forward to that runtime's OpenAI-compatible
endpoint." Non-streaming responses are parsed and returned as-is;
streaming responses are proxied byte-for-byte (no re-parsing/re-serializing
SSE), so client-side OpenAI SDKs work unmodified against either runtime.

## Endpoints

- `GET /models` — OpenAI-style `{ object: "list", data: [...] }` over
  models currently `available`/`loaded` in the registry.
- `POST /chat/completions` — OpenAI-compatible request
  (`{model, messages, stream?, temperature?, max_tokens?}`) and response.
  Errors use OpenAI's `{error: {message, type}}` envelope.

## Also exported: `parseSseChunk`

A pure function that extracts OpenAI-style SSE `delta.content`/
`message.content` text from a raw SSE byte chunk, tolerant of partial
lines split across chunk boundaries (the caller holds the `remainder`
buffer across calls) and of `[DONE]`/malformed lines. Used by Orca AI's
conversations route (`api/src/routes/conversations.ts`) to accumulate the
full assistant reply for persistence while still passing the raw bytes
through to the client unmodified. The `ai/` frontend keeps its own small
copy (`ai/src/sseParser.ts`) rather than depending on this package
directly, since importing it would pull an Express-based entry point into
a browser bundle — see `docs/PROGRESS.md`'s architecture decisions.

## Configuration

- `ORCA_OLLAMA_URL` (default `http://localhost:11434`) — shared with
  `@orca/models`' `OllamaAdapter`.
- `ORCA_LLAMACPP_SERVER_URL` — llama.cpp server's inference endpoint
  (distinct from `ORCA_LLAMACPP_MODELS_DIR`, which is about file
  management, not inference).

## Scope limitation

Same one `@orca/models` documents: routes to whatever single endpoint is
configured per runtime today, not to a specific node's runtime across a
multi-node cluster. See `models/README.md`.

Run tests: `npx vitest run --root ai-gateway` (from `orca-platform/`).
