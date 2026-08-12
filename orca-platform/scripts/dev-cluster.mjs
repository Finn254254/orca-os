#!/usr/bin/env node
// Starts a full local Orca cluster for development/demo purposes:
// Orca Control, 3 simulated Orca Agents, Orca API, Orca Dashboard, Orca
// AI, and Orca Studio.
//
// Usage:
//   node scripts/dev-cluster.mjs
//   npm run dev:cluster   (from orca-platform/)
//
// All state lives under orca-platform/data/dev-cluster/ (gitignored) so
// repeated runs keep node identity across restarts; delete that directory
// for a totally fresh cluster.

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.ORCA_DEV_DATA_DIR ?? join(ROOT, "data", "dev-cluster");

const CLUSTER_TOKEN = process.env.ORCA_CLUSTER_TOKEN ?? "dev-cluster-token";
const SESSION_SECRET = process.env.ORCA_SESSION_SECRET ?? "dev-session-secret";
const ADMIN_USERNAME = process.env.ORCA_ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ORCA_ADMIN_PASSWORD ?? "admin-password";

const CONTROL_PORT = Number(process.env.ORCA_CONTROL_PORT ?? 7000);
const API_PORT = Number(process.env.ORCA_API_PORT ?? 8080);
const DASHBOARD_PORT = Number(process.env.ORCA_DASHBOARD_PORT ?? 5173);
const AI_PORT = Number(process.env.ORCA_AI_PORT ?? 5174);
const STUDIO_PORT = Number(process.env.ORCA_STUDIO_PORT ?? 5175);

const TSX_BIN = join(ROOT, "node_modules", ".bin", "tsx");
const VITE_BIN = join(ROOT, "node_modules", ".bin", "vite");

const NODE_PROFILES = [
  { name: "sim-node-01", group: "default", cpuCores: 8, ramBytes: 16 * 1024 ** 3, gpu: false },
  { name: "sim-node-02", group: "default", cpuCores: 16, ramBytes: 32 * 1024 ** 3, gpu: true },
  { name: "sim-node-03", group: "edge", cpuCores: 4, ramBytes: 8 * 1024 ** 3, gpu: false },
];

const children = [];
let shuttingDown = false;

function log(name, stream, chunk) {
  const prefix = `[${name}]`;
  const text = chunk.toString();
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    (stream === "err" ? process.stderr : process.stdout).write(`${prefix} ${line}\n`);
  }
}

function spawnNamed(name, cmd, args, env, cwd) {
  const proc = spawn(cmd, args, { cwd: cwd ?? ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout.on("data", (d) => log(name, "out", d));
  proc.stderr.on("data", (d) => log(name, "err", d));
  proc.on("exit", (code, signal) => {
    if (!shuttingDown) {
      log(name, "err", `exited unexpectedly (code=${code}, signal=${signal})`);
    }
  });
  children.push({ name, proc });
  return proc;
}

async function waitForHealth(url, name, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${name} did not become healthy within ${timeoutMs}ms (${url})`);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nShutting down dev cluster…");
  for (const { proc } of children) {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  console.log("Starting Orca Control…");
  spawnNamed("control", TSX_BIN, ["control/src/index.ts"], {
    ORCA_CONTROL_PORT: String(CONTROL_PORT),
    ORCA_CLUSTER_TOKEN: CLUSTER_TOKEN,
    ORCA_DATA_DIR: join(DATA_DIR, "control"),
    ORCA_LOG_PRETTY: "0",
  });
  await waitForHealth(`http://127.0.0.1:${CONTROL_PORT}/api/v1/health`, "orca-control");
  console.log(`Orca Control is up on :${CONTROL_PORT}`);

  console.log(`Starting ${NODE_PROFILES.length} simulated Orca Agents…`);
  for (const profile of NODE_PROFILES) {
    spawnNamed(profile.name, TSX_BIN, ["agent/src/index.ts"], {
      ORCA_CONTROL_URL: `ws://127.0.0.1:${CONTROL_PORT}/mesh`,
      ORCA_CLUSTER_TOKEN: CLUSTER_TOKEN,
      ORCA_NODE_NAME: profile.name,
      ORCA_NODE_GROUP: profile.group,
      ORCA_SIMULATED: "1",
      ORCA_SIM_CPU_CORES: String(profile.cpuCores),
      ORCA_SIM_RAM_BYTES: String(profile.ramBytes),
      ORCA_SIM_GPU: profile.gpu ? "1" : "0",
      ORCA_DATA_DIR: join(DATA_DIR, profile.name),
      ORCA_LOG_PRETTY: "0",
    });
  }

  console.log("Starting Orca API…");
  spawnNamed("api", TSX_BIN, ["api/src/index.ts"], {
    ORCA_API_PORT: String(API_PORT),
    ORCA_CONTROL_URL: `http://127.0.0.1:${CONTROL_PORT}`,
    ORCA_SESSION_SECRET: SESSION_SECRET,
    ORCA_ADMIN_USERNAME: ADMIN_USERNAME,
    ORCA_ADMIN_PASSWORD: ADMIN_PASSWORD,
    ORCA_DATA_DIR: join(DATA_DIR, "api"),
    ORCA_LOG_PRETTY: "0",
  });
  await waitForHealth(`http://127.0.0.1:${API_PORT}/api/v1/health`, "orca-api");
  console.log(`Orca API is up on :${API_PORT}`);

  console.log("Starting Orca Dashboard…");
  spawnNamed(
    "dashboard",
    VITE_BIN,
    ["--port", String(DASHBOARD_PORT), "--strictPort"],
    { ORCA_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    join(ROOT, "dashboard"),
  );
  await waitForHealth(`http://127.0.0.1:${DASHBOARD_PORT}`, "orca-dashboard");

  console.log("Starting Orca AI…");
  spawnNamed(
    "ai",
    VITE_BIN,
    ["--port", String(AI_PORT), "--strictPort"],
    { ORCA_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    join(ROOT, "ai"),
  );
  await waitForHealth(`http://127.0.0.1:${AI_PORT}`, "orca-ai");

  console.log("Starting Orca Studio…");
  spawnNamed(
    "studio",
    VITE_BIN,
    ["--port", String(STUDIO_PORT), "--strictPort"],
    { ORCA_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    join(ROOT, "studio"),
  );
  await waitForHealth(`http://127.0.0.1:${STUDIO_PORT}`, "orca-studio");

  console.log("\n=========================================");
  console.log(" Orca dev cluster is up");
  console.log("=========================================");
  console.log(` Dashboard: http://localhost:${DASHBOARD_PORT}`);
  console.log(` Orca AI:   http://localhost:${AI_PORT}`);
  console.log(` Studio:    http://localhost:${STUDIO_PORT}`);
  console.log(` API:       http://localhost:${API_PORT}/api/v1`);
  console.log(` Control:   http://localhost:${CONTROL_PORT}/api/v1`);
  console.log(` Login:     ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  console.log(` CLI:       ORCA_API_URL=http://localhost:${API_PORT} node cli/bin/orca.mjs login -u ${ADMIN_USERNAME} -p ${ADMIN_PASSWORD}`);
  console.log(" Press Ctrl+C to stop everything.");
  console.log("=========================================\n");
}

main().catch((err) => {
  console.error(err);
  shutdown();
  process.exitCode = 1;
});
