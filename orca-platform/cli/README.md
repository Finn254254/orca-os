# @orca/cli

The `orca` command-line client. Talks only to Orca API — never touches
Control, Agents, or system services directly.

## Usage

```bash
orca login --url http://localhost:8080 -u admin -p <password>
orca status
orca nodes
orca node <id>
orca metrics <id>
orca services <id>
orca version
orca logout
```

`--url`/`--token` flags (or `ORCA_API_URL`/`ORCA_API_TOKEN` env vars)
override the saved login for one-off/scripted use without `orca login`.

Planned commands whose backing subsystems land in later phases —
`run` (Compute), `deploy` (Deploy), `update` (Update), `power` (Hardware
Daemon), `backup` (Backup) — are registered now so the CLI's shape is
stable, and each clearly reports what it needs when invoked rather than
silently doing nothing. `models`/`jobs`/`logs` call the corresponding Orca
API endpoints, which return 404 until the Model Manager/Compute/log
aggregation subsystems exist (Phases 9-14) — the CLI surfaces that as a
clear "may not be implemented yet" hint rather than a raw stack trace.

## Running from source

```bash
node bin/orca.mjs <command>     # from orca-platform/cli/
# or, for iterating on the CLI itself:
npm run dev -- <command>
```

`bin/orca.mjs` runs the TypeScript source directly via `tsx` — a
development-mode distribution that works anywhere inside this monorepo. A
compiled, npm-publishable binary is future work once the CLI needs to be
distributed outside this checkout.

Run tests: `npx vitest run --root cli` (unit) and
`npx vitest run --root tests` (end-to-end, spawns the real binary against
real Control + API processes).
