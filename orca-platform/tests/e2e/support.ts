import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const PLATFORM_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface SpawnedProcess {
  proc: ChildProcessWithoutNullStreams;
  logs: string[];
  stop: () => Promise<void>;
}

const TSX_BIN = join(PLATFORM_ROOT, "node_modules", ".bin", "tsx");

/** Spawns a platform service (e.g. control or agent) via tsx from the monorepo root. */
export function spawnService(entry: string, env: Record<string, string>): SpawnedProcess {
  const proc = spawn(TSX_BIN, [entry], {
    cwd: PLATFORM_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  proc.stdout.on("data", (d) => logs.push(String(d)));
  proc.stderr.on("data", (d) => logs.push(String(d)));

  return {
    proc,
    logs,
    stop: () =>
      new Promise<void>((resolve) => {
        if (proc.exitCode !== null || proc.signalCode !== null) {
          resolve();
          return;
        }
        proc.once("exit", () => resolve());
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
        }, 3000).unref();
      }),
  };
}

export async function waitUntil(predicate: () => Promise<boolean> | boolean, timeoutMs = 20000, intervalMs = 150): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms${lastError ? `: ${String(lastError)}` : ""}`);
}

export function pickPort(): number {
  // Ports in the high dynamic range; tests run sequentially so collisions are unlikely,
  // and each waitUntil-based health check will simply retry if one occurs.
  return 20000 + Math.floor(Math.random() * 20000);
}
