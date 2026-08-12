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

orca run <command...>            # submit a compute job, wait for it, print the result
orca jobs / orca job <id>
orca models / orca model-pull <runtime> <name>

orca deploy <manifest.json>      # deploy an app from a manifest file
orca apps / orca app <id>
orca remove <id>                 # stop an app deployment

orca update publish <version> <artifactUrl> <checksum>
orca update rollout <version> [--group <g>] [--staged <pct>]
orca update status <rolloutId>
orca update continue <rolloutId>
orca update rollback <rolloutId>

orca backup run <kind> [--target <id>]     # kind: cluster-config | app-config
orca backup list
orca backup schedule <kind> <intervalMs>
orca backup restore <backupId> --by <who>
```

`--url`/`--token` flags (or `ORCA_API_URL`/`ORCA_API_TOKEN` env vars)
override the saved login for one-off/scripted use without `orca login`.

`power` is registered now (its backing subsystem, Hardware Daemon, exists
but isn't wired cluster-wide yet — see `hardware-daemon/README.md`) so the
CLI's shape is stable, and clearly reports what it needs when invoked
rather than silently doing nothing. `logs` calls the
corresponding Orca API endpoint, which returns 404 until log aggregation
exists — the CLI surfaces that as a clear "may not be implemented yet"
hint rather than a raw stack trace.

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
