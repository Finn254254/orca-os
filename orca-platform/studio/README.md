# @orca/studio

Orca Studio: the agent/workflow builder frontend. React + Vite +
TypeScript, same conventions as `@orca/dashboard` and `@orca/ai` (no UI
framework, shared design tokens). Its backend — per-user agent configs,
workflows, and run history — lives directly in `@orca/api`
(`api/src/studioService.ts` and `api/src/routes/studio.ts`), mounted at
`/api/v1/studio`; see that package's README for why.

## Running

```bash
ORCA_API_PROXY_TARGET=http://localhost:8080 npm run dev
```

The dev server (default port `5175`) proxies `/api` to Orca API (see
`vite.config.ts`), so the browser talks to same-origin paths with no CORS
setup needed in development. For a production build served separately
from the API, set `VITE_ORCA_API_URL` at build time to the API's origin.

## Features

- **Agent configs**: a sidebar list plus an editor for `name`,
  `systemPrompt`, `model` (from the AI Gateway's available-models list),
  and `tools` (a comma-separated list — declarative metadata only, see
  "Scope" below). Save creates or updates; Delete removes.
- **Workflows**: an ordered, reorderable list of steps, each referencing a
  saved agent config. Steps run in order at execution time, chaining each
  step's output into the next step's input.
- **Testing console**: shown once an agent config or workflow is selected.
  Type an input, hit Run, and see the result — status, per-step
  input/output/latency for workflows, and the final output/error.
- **Run history**: a "Runs" tab lists every past testing-console
  execution (agent or workflow); selecting one shows the same result view
  used by the live console.

## Scope

Tool *execution* is out of scope for this phase — an agent config's
`tools` field is saved and displayed but never invoked. Actually calling
tools needs a function-calling-capable runtime integration (tool-call
parsing, a tool registry, a sandboxed execution path) that doesn't exist
yet; see `docs/PROGRESS.md`'s known limitations.

Verified end-to-end in a real headless-browser test
(`orca-platform/tests/e2e/studio.test.ts`): logs in, creates an agent
config against a real registered model, runs it through the testing
console against a fake Ollama/OpenAI-shaped upstream server (real Control
+ API processes underneath), and confirms the run then appears under the
Runs tab.

Run tests: `npx vitest run --root studio` (component/unit, jsdom) and
`npx vitest run --root tests` (includes the Playwright browser e2e test).
