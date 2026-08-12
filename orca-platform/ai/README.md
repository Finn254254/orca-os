# @orca/ai

Orca AI: the user-facing chat app. React + Vite + TypeScript, no UI
framework dependency — styled from the same design tokens as
`@orca/dashboard`, light/dark aware.

## Running

```bash
ORCA_API_PROXY_TARGET=http://localhost:8080 npm run dev
```

The dev server proxies `/api` to Orca API (see `vite.config.ts`), so the
browser talks to same-origin paths with no CORS setup needed in
development. For a production build served separately from the API, set
`VITE_ORCA_API_URL` at build time to the API's origin.

## Features

- **Conversation history** — a sidebar lists the signed-in user's
  conversations (persisted server-side via `/api/v1/ai/conversations`),
  with inline rename (double-click a title) and delete.
- **Model selection** — a dropdown of models the AI Gateway currently has a
  runtime for (`GET /api/v1/ai/models`, i.e. registered models in
  `available`/`loaded` state). Fixed once a conversation has its first
  message; a new chat can pick a different model.
- **Streaming** — replies stream token-by-token from Orca API's SSE
  endpoint (`POST /api/v1/ai/conversations/:id/messages`), rendered live
  with a blinking cursor while in flight.
- **Markdown + code rendering** — a small dependency-free renderer
  (`src/components/Markdown.tsx`) turns headings, bold/italic, inline
  code, fenced code blocks (with a language label), links, and lists into
  real React elements — never `dangerouslySetInnerHTML`, so there's no
  HTML-injection surface from a model's output.
- **Server-side conversation storage** — messages are persisted by Orca
  API (`@orca/api`'s `ConversationStore`), not just held in browser state;
  reloading the page and reselecting a conversation shows the full
  history.
- File upload architecture: not yet implemented — no attachment UI or
  upload endpoint exists yet. Left for a follow-up phase once a concrete
  storage target (Orca Storage locations) is wired up for it.

Verified end-to-end in a real headless-browser test
(`orca-platform/tests/e2e/ai.test.ts`): logs in, picks a real registered
model, sends a message, and asserts the assistant's reply streams in and
renders through the real Markdown renderer (bold text becomes a real
`<strong>`) — against real Control + API processes and a fake
OpenAI/Ollama-shaped upstream runtime server, not a mock of the app
itself.

Run tests: `npx vitest run --root ai` (component/unit, jsdom) and
`npx vitest run --root tests` (includes the Playwright browser e2e test).
