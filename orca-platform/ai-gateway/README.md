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
