# @orca/models

Orca Model Manager: a registry over runtime adapters. Per the build
instructions, Orca does not implement its own inference engine — it adapts
existing runtimes. Mounted into Orca API at `/api/v1/models`.

## Adapters

- **Ollama** (`adapters/ollama.ts`): real HTTP client against Ollama's
  documented API (`GET /api/tags`, `POST /api/pull` streaming NDJSON
  progress, `DELETE /api/delete`). Configured via `ORCA_OLLAMA_URL`
  (default `http://localhost:11434`).
- **llama.cpp** (`adapters/llamacpp.ts`): filesystem-based — llama.cpp has
  no network "pull" API, so this lists/deletes `.gguf` files in a directory
  (`ORCA_LLAMACPP_MODELS_DIR`, default `./models`); `pullModel` throws a
  clear "not supported" error.

**Honesty note**: this environment had no way to run a live Ollama server
to verify `OllamaAdapter` against (no such service available here), so its
tests exercise a fake HTTP server built to Ollama's documented API shape,
not a real instance. `LlamaCppAdapter` is fully verified with real
filesystem operations. Treat `OllamaAdapter` as implemented-to-spec but
not yet field-verified — a good first thing to check when it's used
against a real `ollama serve`.

## Scope limitation

This phase manages models for whatever runtime endpoint each adapter is
configured against (today: one Ollama instance, one llama.cpp models
directory). Automatically discovering/routing to a *specific* node's
runtime across a multi-node cluster is AI Gateway/Scheduler territory —
`nodeId` on a model record is informational until that's built.

Run tests: `npx vitest run --root models` (from `orca-platform/`).
