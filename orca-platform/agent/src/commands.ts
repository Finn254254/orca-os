import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppManifest, CommandRecord, CommandStatus } from "@orca/shared";
import type { AgentConfig } from "./config.js";

const execFileAsync = promisify(execFile);

export interface CommandOutcome {
  status: CommandStatus;
  result?: Record<string, unknown>;
  error?: string;
}

const SERVICE_ACTIONS = { start_service: "start", stop_service: "stop", restart_service: "restart" } as const;

export async function executeCommand(command: CommandRecord, config: AgentConfig): Promise<CommandOutcome> {
  switch (command.type) {
    case "ping":
      return { status: "succeeded", result: { pong: true, time: new Date().toISOString() } };

    case "start_service":
    case "stop_service":
    case "restart_service":
      return runServiceAction(SERVICE_ACTIONS[command.type], command.payload);

    case "shell":
      return runShell(command.payload, config);

    case "power":
      return runPower(command.payload, config);

    case "run_job":
      return runJob(command.payload, config);

    case "deploy_app":
      return deployApp(command.payload, config);

    case "remove_app":
      return removeApp(command.payload, config);

    case "apply_update":
      return applyUpdate(command.payload, config);

    case "rollback_update":
      return rollbackUpdate(command.payload, config);

    default:
      return { status: "failed", error: `unknown command type: ${command.type satisfies never}` };
  }
}

async function runServiceAction(action: "start" | "stop" | "restart", payload: Record<string, unknown>): Promise<CommandOutcome> {
  const service = payload.service;
  if (typeof service !== "string" || !service) {
    return { status: "failed", error: "payload.service (string) is required" };
  }
  try {
    const { stdout, stderr } = await execFileAsync("systemctl", [action, service], { timeout: 15_000 });
    return { status: "succeeded", result: { stdout, stderr } };
  } catch (err) {
    return { status: "failed", error: describeError(err) };
  }
}

async function runShell(payload: Record<string, unknown>, config: AgentConfig): Promise<CommandOutcome> {
  if (!config.allowShellCommands) {
    return { status: "failed", error: "shell commands are disabled on this agent (set ORCA_ALLOW_SHELL_COMMANDS=1 to enable)" };
  }
  const args = payload.command;
  if (!Array.isArray(args) || args.length === 0 || !args.every((a) => typeof a === "string")) {
    return { status: "failed", error: "payload.command must be a non-empty string array, e.g. [\"echo\", \"hi\"]" };
  }
  try {
    const [file, ...rest] = args as string[];
    const { stdout, stderr } = await execFileAsync(file, rest, { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    return { status: "succeeded", result: { stdout, stderr } };
  } catch (err) {
    return { status: "failed", error: describeError(err) };
  }
}

async function runPower(payload: Record<string, unknown>, config: AgentConfig): Promise<CommandOutcome> {
  const action = payload.action === "shutdown" ? "poweroff" : payload.action === "reboot" ? "reboot" : undefined;
  if (!action) {
    return { status: "failed", error: 'payload.action must be "reboot" or "shutdown"' };
  }
  if (config.simulated) {
    return { status: "succeeded", result: { simulated: true, action } };
  }
  if (!config.allowPowerCommands) {
    return { status: "failed", error: "power commands are disabled on this agent (set ORCA_ALLOW_POWER_COMMANDS=1 to enable)" };
  }
  try {
    await execFileAsync("systemctl", [action], { timeout: 5000 });
    return { status: "succeeded", result: { action } };
  } catch (err) {
    return { status: "failed", error: describeError(err) };
  }
}

async function runJob(payload: Record<string, unknown>, config: AgentConfig): Promise<CommandOutcome> {
  const args = payload.command;
  if (!Array.isArray(args) || args.length === 0 || !args.every((a) => typeof a === "string")) {
    return { status: "failed", error: "payload.command must be a non-empty string array" };
  }

  if (config.simulated) {
    // Simulated nodes represent fake hardware — never actually exec on the host
    // running the simulated agent. Simulate plausible timing/output instead.
    await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 1200));
    if (payload.forceFail) {
      return { status: "failed", error: "simulated job failure (payload.forceFail was set)" };
    }
    return {
      status: "succeeded",
      result: { simulated: true, stdout: `[simulated] ran: ${(args as string[]).join(" ")}`, exitCode: 0 },
    };
  }

  if (!config.allowComputeJobs) {
    return { status: "failed", error: "compute jobs are disabled on this agent (set ORCA_ALLOW_COMPUTE_JOBS=0 was set, or unset it to re-enable)" };
  }
  try {
    const [file, ...rest] = args as string[];
    const timeout = typeof payload.timeoutMs === "number" ? payload.timeoutMs : 5 * 60_000;
    const { stdout, stderr } = await execFileAsync(file, rest, { timeout, maxBuffer: 8 * 1024 * 1024 });
    return { status: "succeeded", result: { stdout, stderr, exitCode: 0 } };
  } catch (err) {
    return { status: "failed", error: describeError(err) };
  }
}

const DOCKER_RESTART_POLICY = { always: "always", "on-failure": "on-failure", never: "no" } as const;

function dockerArgsFor(manifest: AppManifest): string[] {
  const args = ["run", "-d", "--name", manifest.name, "--restart", DOCKER_RESTART_POLICY[manifest.restartPolicy]];
  for (const port of manifest.ports) {
    args.push("-p", `${port.hostPort ?? port.containerPort}:${port.containerPort}/${port.protocol}`);
  }
  for (const volume of manifest.volumes) {
    args.push("-v", `${volume.hostPath}:${volume.containerPath}${volume.readOnly ? ":ro" : ""}`);
  }
  for (const [key, value] of Object.entries(manifest.env)) {
    args.push("-e", `${key}=${value}`);
  }
  args.push(`${manifest.image}:${manifest.version}`);
  return args;
}

async function deployApp(payload: Record<string, unknown>, config: AgentConfig): Promise<CommandOutcome> {
  const manifest = payload.manifest as AppManifest | undefined;
  if (!manifest?.name || !manifest.image) {
    return { status: "failed", error: "payload.manifest with at least name and image is required" };
  }

  if (config.simulated) {
    await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 800));
    return { status: "succeeded", result: { simulated: true, containerId: `sim-${manifest.name}` } };
  }
  if (!config.allowComputeJobs) {
    return { status: "failed", error: "app deployment is disabled on this agent (set ORCA_ALLOW_COMPUTE_JOBS=0 was set, or unset it to re-enable)" };
  }
  try {
    const { stdout } = await execFileAsync("docker", dockerArgsFor(manifest), { timeout: 120_000 });
    return { status: "succeeded", result: { containerId: stdout.trim() } };
  } catch (err) {
    return { status: "failed", error: describeError(err) };
  }
}

async function removeApp(payload: Record<string, unknown>, config: AgentConfig): Promise<CommandOutcome> {
  const name = payload.name;
  if (typeof name !== "string" || !name) {
    return { status: "failed", error: "payload.name (string) is required" };
  }
  if (config.simulated) {
    return { status: "succeeded", result: { simulated: true } };
  }
  try {
    await execFileAsync("docker", ["rm", "-f", name], { timeout: 30_000 });
    return { status: "succeeded", result: { removed: name } };
  } catch (err) {
    return { status: "failed", error: describeError(err) };
  }
}

const UPDATER_BIN = process.env.ORCA_OS_UPDATER_BIN ?? "orca-os-updater";

async function applyUpdate(payload: Record<string, unknown>, config: AgentConfig): Promise<CommandOutcome> {
  const version = payload.version;
  const artifactUrl = payload.artifactUrl;
  if (typeof version !== "string" || typeof artifactUrl !== "string") {
    return { status: "failed", error: "payload.version and payload.artifactUrl (strings) are required" };
  }
  if (config.simulated) {
    await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 700));
    return { status: "succeeded", result: { simulated: true, version, installed: true } };
  }
  try {
    const { stdout } = await execFileAsync(UPDATER_BIN, ["apply", artifactUrl, String(payload.checksum ?? "")], { timeout: 600_000 });
    return { status: "succeeded", result: { version, installed: true, stdout } };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // No OS-level updater installed on this node yet — see orca-platform/docs/OS_INTEGRATION.md.
      // Logging-only fallback so the rollout pipeline can be exercised before Orca OS ships one.
      return { status: "succeeded", result: { version, installed: false, reason: `${UPDATER_BIN} not found; logged only (see OS_INTEGRATION.md)` } };
    }
    return { status: "failed", error: describeError(err) };
  }
}

async function rollbackUpdate(payload: Record<string, unknown>, config: AgentConfig): Promise<CommandOutcome> {
  if (config.simulated) {
    return { status: "succeeded", result: { simulated: true, rolledBack: true } };
  }
  try {
    const { stdout } = await execFileAsync(UPDATER_BIN, ["rollback"], { timeout: 300_000 });
    return { status: "succeeded", result: { rolledBack: true, stdout } };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "succeeded", result: { rolledBack: false, reason: `${UPDATER_BIN} not found; logged only (see OS_INTEGRATION.md)` } };
    }
    return { status: "failed", error: describeError(err) };
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
