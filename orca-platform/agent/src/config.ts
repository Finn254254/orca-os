import { hostname } from "node:os";
import { join } from "node:path";

export interface AgentConfig {
  controlUrl: string;
  clusterToken: string;
  nodeName: string;
  nodeGroup: string;
  dataDir: string;
  simulated: boolean;
  heartbeatIntervalMs: number;
  allowPowerCommands: boolean;
  allowShellCommands: boolean;
  allowComputeJobs: boolean;
}

export function loadAgentConfig(): AgentConfig {
  const controlUrl = process.env.ORCA_CONTROL_URL;
  if (!controlUrl) {
    throw new Error("ORCA_CONTROL_URL is not set (e.g. ws://localhost:7000/mesh)");
  }
  const clusterToken = process.env.ORCA_CLUSTER_TOKEN;
  if (!clusterToken) {
    throw new Error("ORCA_CLUSTER_TOKEN is not set. It must match Orca Control's configured token.");
  }
  return {
    controlUrl,
    clusterToken,
    nodeName: process.env.ORCA_NODE_NAME ?? hostname(),
    nodeGroup: process.env.ORCA_NODE_GROUP ?? "default",
    dataDir: process.env.ORCA_DATA_DIR ?? join(process.cwd(), "data"),
    simulated: process.env.ORCA_SIMULATED === "1" || process.env.ORCA_SIMULATED === "true",
    heartbeatIntervalMs: Number(process.env.ORCA_HEARTBEAT_INTERVAL_MS ?? 5000),
    // Default-safe: never execute real power actions or shell commands unless explicitly opted in.
    allowPowerCommands: process.env.ORCA_ALLOW_POWER_COMMANDS === "1" || process.env.ORCA_ALLOW_POWER_COMMANDS === "true",
    allowShellCommands: process.env.ORCA_ALLOW_SHELL_COMMANDS === "1" || process.env.ORCA_ALLOW_SHELL_COMMANDS === "true",
    // Compute jobs are the platform's core purpose (unlike raw shell access), so default on;
    // still overridable per node for anyone who wants job execution opt-in instead.
    allowComputeJobs: process.env.ORCA_ALLOW_COMPUTE_JOBS !== "0" && process.env.ORCA_ALLOW_COMPUTE_JOBS !== "false",
  };
}
