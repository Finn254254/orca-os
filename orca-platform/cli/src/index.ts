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
  .description("List registered AI models")
  .option("--json", "output raw JSON")
  .action((opts) =>
    run(async () => {
      const api = await client();
      const models = await api.get<
        { id: string; name: string; runtime: string; state: string; downloadProgressPct?: number }[]
      >("/api/v1/models");
      if (opts.json) return printJson(models);
      console.log(
        table(
          models.map((m) => ({
            id: m.id,
            name: m.name,
            runtime: m.runtime,
            state: m.state,
            progress: m.downloadProgressPct !== undefined ? `${m.downloadProgressPct}%` : "-",
          })),
        ),
      );
    }),
  );

program
  .command("model-pull <runtime> <name>")
  .description('Pull a model from a runtime, e.g. "orca model-pull ollama llama3"')
  .action((runtimeArg, name) =>
    run(async () => {
      const api = await client();
      const model = await api.post("/api/v1/models/pull", { runtime: runtimeArg, name });
      printJson(model);
    }),
  );

interface JobSummary {
  id: string;
  spec: { type: string; command?: string[] };
  state: string;
  assignedNodeId?: string;
  createdAt: string;
}

program
  .command("jobs")
  .description("List compute jobs")
  .option("--json", "output raw JSON")
  .action((opts) =>
    run(async () => {
      const api = await client();
      const jobs = await api.get<JobSummary[]>("/api/v1/jobs");
      if (opts.json) return printJson(jobs);
      console.log(
        table(
          jobs.map((j) => ({
            id: j.id,
            type: j.spec.type,
            state: j.state,
            node: j.assignedNodeId ?? "-",
            created: new Date(j.createdAt).toLocaleString(),
          })),
        ),
      );
    }),
  );

program
  .command("job <id>")
  .description("Show details for one compute job")
  .action((id) =>
    run(async () => {
      const api = await client();
      printJson(await api.get(`/api/v1/jobs/${encodeURIComponent(id)}`));
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

program
  .command("run <command...>")
  .description("Submit a compute job and wait for it to finish")
  .option("--node <id>", "pin to a specific node id")
  .option("--group <group>", "pin to a specific node group")
  .option("--gpu", "require a GPU")
  .action((command: string[], opts) =>
    run(async () => {
      const api = await client();
      const job = await api.post<{ id: string; state: string }>("/api/v1/jobs", {
        type: "shell",
        command,
        resources: opts.gpu ? { gpu: true } : {},
        targetNodeId: opts.node,
        targetGroup: opts.group,
      });
      console.log(`job ${job.id} submitted (${job.state})`);

      const start = Date.now();
      while (Date.now() - start < 30000) {
        const current = await api.get<{ state: string; result?: Record<string, unknown>; failureReason?: string }>(
          `/api/v1/jobs/${job.id}`,
        );
        if (current.state === "succeeded") {
          console.log("succeeded");
          if (current.result) printJson(current.result);
          return;
        }
        if (current.state === "failed" || current.state === "cancelled") {
          console.error(`${current.state}: ${current.failureReason ?? "no reason given"}`);
          process.exitCode = 1;
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      console.error(`job ${job.id} is still running after 30s — check \`orca job ${job.id}\` for status`);
      process.exitCode = 1;
    }),
  );

interface AppDeploymentSummary {
  id: string;
  manifest: { name: string; image: string; version: string };
  state: string;
  assignedNodeId?: string;
  createdAt: string;
}

program
  .command("deploy <manifestFile>")
  .description("Deploy an application from a manifest JSON file")
  .action((manifestFile: string) =>
    run(async () => {
      const raw = await import("node:fs/promises").then((fs) => fs.readFile(manifestFile, "utf-8"));
      const manifest = JSON.parse(raw);
      const api = await client();
      const deployment = await api.post<AppDeploymentSummary>("/api/v1/apps", manifest);
      console.log(`app ${deployment.id} (${deployment.manifest.name}) — ${deployment.state}`);
    }),
  );

program
  .command("apps")
  .description("List app deployments")
  .option("--json", "output raw JSON")
  .action((opts) =>
    run(async () => {
      const api = await client();
      const apps = await api.get<AppDeploymentSummary[]>("/api/v1/apps");
      if (opts.json) return printJson(apps);
      console.log(
        table(
          apps.map((a) => ({
            id: a.id,
            name: a.manifest.name,
            image: `${a.manifest.image}:${a.manifest.version}`,
            state: a.state,
            node: a.assignedNodeId ?? "-",
          })),
        ),
      );
    }),
  );

program
  .command("app <id>")
  .description("Show details for one app deployment")
  .action((id) =>
    run(async () => {
      const api = await client();
      printJson(await api.get(`/api/v1/apps/${encodeURIComponent(id)}`));
    }),
  );

program
  .command("remove <id>")
  .description("Remove (stop) an app deployment")
  .action((id) =>
    run(async () => {
      const api = await client();
      const deployment = await api.delete<AppDeploymentSummary>(`/api/v1/apps/${encodeURIComponent(id)}`);
      console.log(`app ${deployment.id} — ${deployment.state}`);
    }),
  );

const update = program.command("update").description("Cluster-wide update management");

update
  .command("publish <version> <artifactUrl> <checksum>")
  .description("Publish a signed update manifest")
  .action((version, artifactUrl, checksum) =>
    run(async () => {
      const api = await client();
      printJson(await api.post("/api/v1/updates/manifests", { version, artifactUrl, checksum }));
    }),
  );

update
  .command("rollout <version>")
  .description("Start a rollout")
  .option("--group <group>", "target a node group")
  .option("--staged <pct>", "staged rollout batch percentage (default: all at once)")
  .action((version, opts) =>
    run(async () => {
      const api = await client();
      const rollout = await api.post<{ id: string; state: string }>("/api/v1/updates/rollouts", {
        version,
        targetGroup: opts.group,
        strategy: opts.staged ? "staged" : "all-at-once",
        stagePct: opts.staged ? Number(opts.staged) : undefined,
      });
      console.log(`rollout ${rollout.id} — ${rollout.state}`);
    }),
  );

update
  .command("status <rolloutId>")
  .description("Show a rollout's status")
  .action((rolloutId) =>
    run(async () => {
      const api = await client();
      printJson(await api.get(`/api/v1/updates/rollouts/${encodeURIComponent(rolloutId)}`));
    }),
  );

update
  .command("continue <rolloutId>")
  .description("Continue a staged rollout to its next batch")
  .action((rolloutId) =>
    run(async () => {
      const api = await client();
      printJson(await api.post(`/api/v1/updates/rollouts/${encodeURIComponent(rolloutId)}/continue`));
    }),
  );

update
  .command("rollback <rolloutId>")
  .description("Roll back a rollout's successfully-updated nodes")
  .action((rolloutId) =>
    run(async () => {
      const api = await client();
      printJson(await api.post(`/api/v1/updates/rollouts/${encodeURIComponent(rolloutId)}/rollback`));
    }),
  );

const backup = program.command("backup").description("Backup management");

backup
  .command("run <kind>")
  .description('Run a backup now: "cluster-config" or "app-config" (needs --target)')
  .option("--target <id>", "target id (deployment id, for app-config)")
  .action((kind, opts) =>
    run(async () => {
      const api = await client();
      const job = await api.post<{ id: string; state: string }>("/api/v1/backups", { kind, targetId: opts.target });
      console.log(`backup ${job.id} — ${job.state}`);
    }),
  );

backup
  .command("list")
  .description("List backup jobs")
  .option("--json", "output raw JSON")
  .action((opts) =>
    run(async () => {
      const api = await client();
      const jobs = await api.get<{ id: string; kind: string; state: string; createdAt: string }[]>("/api/v1/backups");
      if (opts.json) return printJson(jobs);
      console.log(table(jobs.map((j) => ({ id: j.id, kind: j.kind, state: j.state, created: new Date(j.createdAt).toLocaleString() }))));
    }),
  );

backup
  .command("schedule <kind> <intervalMs>")
  .description("Create a recurring backup schedule")
  .option("--target <id>", "target id (deployment id, for app-config)")
  .action((kind, intervalMs, opts) =>
    run(async () => {
      const api = await client();
      const schedule = await api.post("/api/v1/backups/schedules", { kind, intervalMs: Number(intervalMs), targetId: opts.target });
      printJson(schedule);
    }),
  );

backup
  .command("restore <backupId>")
  .description("Record a restore from a succeeded backup")
  .requiredOption("--by <who>", "who is performing the restore")
  .action((backupId, opts) =>
    run(async () => {
      const api = await client();
      printJson(await api.post("/api/v1/backups/restores", { backupJobId: backupId, restoredBy: opts.by }));
    }),
  );

// --- Commands whose backing subsystems land in later phases (Hardware Daemon cluster-wide routing). ---
// Registered now so the CLI's shape is stable; each clearly reports what it needs once invoked.
for (const [name, needs] of [
  ["power", "Orca Hardware Daemon (Phase 15) cluster-wide routing"],
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
