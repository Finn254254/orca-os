import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CommandRecord, CommandStatus } from "@orca/shared";
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

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
