import type { NodeCapabilities, NodeMetrics, ServiceStatus } from "@orca/shared";
import type { MetricsProvider } from "./types.js";

export interface SimulatedProfile {
  cpuModel?: string;
  cpuCores?: number;
  ramTotalBytes?: number;
  diskTotalBytes?: number;
  hasGpu?: boolean;
  vramTotalBytes?: number;
  baselineCpuUtilizationPct?: number;
  baselineTemperatureC?: number;
  services?: string[];
}

const DEFAULT_PROFILE: Required<SimulatedProfile> = {
  cpuModel: "Simulated Orca CPU",
  cpuCores: 8,
  ramTotalBytes: 16 * 1024 ** 3,
  diskTotalBytes: 512 * 1024 ** 3,
  hasGpu: false,
  vramTotalBytes: 8 * 1024 ** 3,
  baselineCpuUtilizationPct: 15,
  baselineTemperatureC: 45,
  services: ["orca-agent"],
};

function jitter(base: number, spread: number): number {
  return Math.max(0, base + (Math.random() - 0.5) * 2 * spread);
}

/**
 * Produces plausible synthetic host metrics without touching real hardware.
 * Used for the multi-node development/demo cluster, and anywhere a node's
 * profile needs to be reproducible/controllable (tests, demos).
 */
export class SimulatedMetricsProvider implements MetricsProvider {
  private readonly profile: Required<SimulatedProfile>;
  private diskUsedBytes: number;
  private ramUsedBytes: number;
  private readonly startedAt = Date.now();

  constructor(profile: SimulatedProfile = {}) {
    // Filter out explicit `undefined` values so callers can pass optional,
    // possibly-unset overrides (e.g. from env vars) without clobbering defaults.
    const definedOverrides = Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== undefined));
    this.profile = { ...DEFAULT_PROFILE, ...definedOverrides };
    this.diskUsedBytes = this.profile.diskTotalBytes * 0.3;
    this.ramUsedBytes = this.profile.ramTotalBytes * 0.25;
  }

  async collectCapabilities(): Promise<NodeCapabilities> {
    const p = this.profile;
    return {
      cpuModel: p.cpuModel,
      cpuCores: p.cpuCores,
      cpuArch: "x86_64",
      ramTotalBytes: p.ramTotalBytes,
      gpus: p.hasGpu
        ? [{ index: 0, vendor: "Simulated", model: "Orca-Sim-GPU", vramTotalBytes: p.vramTotalBytes, vramUsedBytes: 0, utilizationPct: 0 }]
        : [],
      osName: "orca-os-sim",
      osVersion: "0.1.0-sim",
      orcaVersion: "0.1.0-sim",
      tags: ["simulated"],
    };
  }

  async collectMetrics(): Promise<NodeMetrics> {
    const p = this.profile;
    this.ramUsedBytes = clamp(jitter(this.ramUsedBytes, p.ramTotalBytes * 0.02), p.ramTotalBytes * 0.1, p.ramTotalBytes * 0.9);
    this.diskUsedBytes = clamp(this.diskUsedBytes + Math.random() * 1024 * 1024, 0, p.diskTotalBytes * 0.95);
    const cpuUtilizationPct = clamp(jitter(p.baselineCpuUtilizationPct, 12), 0, 100);

    return {
      timestamp: new Date().toISOString(),
      cpuUtilizationPct: Math.round(cpuUtilizationPct * 10) / 10,
      loadAverage: [cpuUtilizationPct / 100, cpuUtilizationPct / 100, cpuUtilizationPct / 100],
      ramUsedBytes: Math.round(this.ramUsedBytes),
      ramTotalBytes: p.ramTotalBytes,
      disks: [{ mount: "/", totalBytes: p.diskTotalBytes, usedBytes: Math.round(this.diskUsedBytes), filesystem: "ext4" }],
      network: [{ name: "eth0", rxBytesPerSec: Math.round(jitter(50_000, 40_000)), txBytesPerSec: Math.round(jitter(20_000, 15_000)) }],
      gpus: p.hasGpu
        ? [
            {
              index: 0,
              vendor: "Simulated",
              model: "Orca-Sim-GPU",
              vramTotalBytes: p.vramTotalBytes,
              vramUsedBytes: Math.round(jitter(p.vramTotalBytes * 0.2, p.vramTotalBytes * 0.05)),
              utilizationPct: Math.round(jitter(10, 8)),
              temperatureC: Math.round(jitter(p.baselineTemperatureC + 5, 4)),
            },
          ]
        : [],
      temperatures: { cpu: Math.round(jitter(p.baselineTemperatureC, 3) * 10) / 10 },
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  async collectServices(): Promise<ServiceStatus[]> {
    return this.profile.services.map((name) => ({ name, state: "running" as const }));
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
