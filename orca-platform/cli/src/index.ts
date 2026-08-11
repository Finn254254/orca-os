#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { ApiClient, ApiClientError } from "./apiClient.js";
import { clearSession, loadSession, resolveApiUrl, resolveToken, saveSession } from "./config.js";
import { bytesToHuman, table } from "./format.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf-8")) as { version: string };

const program = new Command();
program.name("orca").description("Orca Platform command-line client").version(pkg.version);
program.option("--url <url>", "Orca API URL (overrides saved login / ORCA_API_URL)");
program.option("--token <token>", "Session token (overrides saved login / ORCA_API_TOKEN)");

async function client(): Promise<ApiClient> {
  const opts = program.opts<{ url?: string; token?: string }>();
  const apiUrl = await resolveApiUrl(opts.url);
  const token = await resolveToken(opts.token);
  return new ApiClient(apiUrl, token);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiClientError) {
      console.error(`error: ${err.message} (HTTP ${err.status})`);
      if (err.status === 404) {
        console.error("hint: this endpoint may not be implemented yet — see orca-platform/docs/PROGRESS.md");
      }
    } else {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      if (process.env.ORCA_CLI_DEBUG) console.error(err);
    }
    process.exitCode = 1;
  }
}

interface NodeSummary {
  id: string;
  name: string;
  group: string;
  status: string;
  connected: boolean;
  lastMetrics?: { cpuUtilizationPct?: number; ramUsedBytes?: number; ramTotalBytes?: number };
}

program
  .command("login")
  .description("Log in to Orca API and save the session")
  .requiredOption("-u, --username <username>", "username")
  .option("-p, --password <password>", "password (or set ORCA_API_PASSWORD)")
  .action((opts) =>
    run(async () => {
      const password = opts.password ?? process.env.ORCA_API_PASSWORD;
      if (!password) throw new Error("--password is required (or set ORCA_API_PASSWORD)");
      const apiUrl = await resolveApiUrl(program.opts<{ url?: string }>().url);
      const api = new ApiClient(apiUrl);
      const res = await api.post<{ token: string; user: { username: string } }>("/api/v1/auth/login", {
        username: opts.username,
        password,
      });
      await saveSession({ apiUrl, token: res.token, username: res.user.username });
      console.log(`logged in as ${res.user.username} at ${apiUrl}`);
    }),
  );

program
  .command("logout")
  .description("Clear the saved Orca API session")
  .action(() =>
    run(async () => {
      await clearSession();
      console.log("logged out");
    }),
  );

program
  .command("status")
  .description("Show overall cluster health")
  .action(() =>
    run(async () => {
      const api = await client();
      const [config, nodes] = await Promise.all([
        api.get<{ clusterName: string }>("/api/v1/cluster/config"),
        api.get<NodeSummary[]>("/api/v1/nodes"),
      ]);
      const online = nodes.filter((n) => n.status === "online").length;
      console.log(`cluster: ${config.clusterName}`);
      console.log(`nodes:   ${nodes.length} total, ${online} online, ${nodes.length - online} offline`);
    }),
  );

program
  .command("nodes")
  .description("List cluster nodes")
  .option("--json", "output raw JSON")
  .action((opts) =>
    run(async () => {
      const api = await client();
      const nodes = await api.get<NodeSummary[]>("/api/v1/nodes");
      if (opts.json) return printJson(nodes);
      console.log(
        table(
          nodes.map((n) => ({
            id: n.id,
            name: n.name,
            group: n.group,
            status: n.status,
            cpu: n.lastMetrics?.cpuUtilizationPct !== undefined ? `${n.lastMetrics.cpuUtilizationPct}%` : "-",
            ram: n.lastMetrics?.ramUsedBytes !== undefined ? bytesToHuman(n.lastMetrics.ramUsedBytes) : "-",
          })),
        ),
      );
    }),
  );

program
  .command("node <id>")
  .description("Show details for one node")
  .option("--json", "output raw JSON")
  .action((id, opts) =>
    run(async () => {
      const api = await client();
      const node = await api.get(`/api/v1/nodes/${encodeURIComponent(id)}`);
      printJson(node);
      if (opts.json) return;
    }),
  );

program
  .command("metrics <id>")
  .description("Show the latest metrics for a node")
  .action((id) =>
    run(async () => {
      const api = await client();
      const metrics = await api.get(`/api/v1/nodes/${encodeURIComponent(id)}/metrics`);
      printJson(metrics);
    }),
  );

program
  .command("services <id>")
  .description("Show reported service status for a node")
  .action((id) =>
    run(async () => {
      const api = await client();
      const node = await api.get<{ services: Record<string, unknown>[] }>(`/api/v1/nodes/${encodeURIComponent(id)}`);
      console.log(table(node.services ?? []));
    }),
  );

program
  .command("logs")
  .description("Show cluster logs (requires the Backup/Compute-era log aggregation, not yet built)")
  .action(() =>
    run(async () => {
      throw new ApiClientError("log aggregation is not implemented yet", 404);
    }),
  );

program
  .command("models")
  .description("List AI models (requires Orca Model Manager, not yet built)")
  .action(() =>
    run(async () => {
      const api = await client();
      await api.get("/api/v1/models");
    }),
  );

program
  .command("jobs")
  .description("List compute jobs (requires Orca Compute, not yet built)")
  .action(() =>
    run(async () => {
      const api = await client();
      await api.get("/api/v1/jobs");
    }),
  );

program
  .command("version")
  .description("Show CLI and cluster version info")
  .action(() =>
    run(async () => {
      console.log(`orca-cli ${pkg.version}`);
      try {
        const api = await client();
        const health = await api.get<{ status: string }>("/api/v1/health");
        const config = await api.get<{ clusterName: string }>("/api/v1/cluster/config");
        console.log(`orca-api  ${health.status} (cluster: ${config.clusterName})`);
      } catch {
        console.log("orca-api  unreachable");
      }
    }),
  );

// --- Commands whose backing subsystems land in later phases (Deploy, Update, Hardware Daemon, Backup). ---
// Registered now so the CLI's shape is stable; each clearly reports what it needs once invoked.
for (const [name, needs] of [
  ["run", "Orca Compute (Phase 9)"],
  ["deploy", "Orca Deploy (Phase 13)"],
  ["update", "Orca Update (Phase 16)"],
  ["power", "Orca Hardware Daemon (Phase 15)"],
  ["backup", "Orca Backup (Phase 17)"],
] as const) {
  program
    .command(`${name} [args...]`)
    .description(`(planned) requires ${needs}`)
    .action(() => {
      console.error(`orca ${name}: not implemented yet — requires ${needs}. See orca-platform/docs/PROGRESS.md.`);
      process.exitCode = 1;
    });
}

await program.parseAsync(process.argv);
