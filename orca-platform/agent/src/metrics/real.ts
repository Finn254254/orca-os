import si from "systeminformation";
import type { GpuInfo, NodeCapabilities, NodeMetrics, ServiceStatus } from "@orca/shared";
import type { MetricsProvider } from "./types.js";

/**
 * Collects real host metrics via `systeminformation`. Works on a stock Linux
 * host today; on Orca OS it will run the same way (see
 * orca-platform/docs/OS_INTEGRATION.md for what the OS should expose for
 * GPU/temperature reporting).
 */
export class RealMetricsProvider implements MetricsProvider {
  constructor(private readonly watchedServices: string[] = []) {}

  async collectCapabilities(): Promise<NodeCapabilities> {
    const [cpu, mem, osInfo, graphics] = await Promise.all([si.cpu(), si.mem(), si.osInfo(), si.graphics()]);
    return {
      cpuModel: [cpu.manufacturer, cpu.brand].filter(Boolean).join(" ").trim() || undefined,
      cpuCores: cpu.cores || undefined,
      cpuArch: osInfo.arch,
      ramTotalBytes: mem.total,
      gpus: toGpuInfo(graphics.controllers, false),
      osName: osInfo.distro || osInfo.platform,
      osVersion: osInfo.release,
      orcaVersion: process.env.ORCA_OS_VERSION,
      tags: [],
    };
  }

  async collectMetrics(): Promise<NodeMetrics> {
    const [load, mem, fsSize, netStats, graphics, temp, time] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.graphics(),
      si.cpuTemperature().catch(() => ({ main: undefined as number | undefined })),
      si.time(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      cpuUtilizationPct: round(load.currentLoad),
      ramUsedBytes: mem.active,
      ramTotalBytes: mem.total,
      disks: fsSize.map((d) => ({
        mount: d.mount,
        device: d.fs,
        totalBytes: d.size,
        usedBytes: d.used,
        filesystem: d.type,
      })),
      network: netStats.map((n) => ({
        name: n.iface,
        rxBytesPerSec: n.rx_sec ?? undefined,
        txBytesPerSec: n.tx_sec ?? undefined,
      })),
      gpus: toGpuInfo(graphics.controllers, true),
      temperatures: temp.main ? { cpu: temp.main } : {},
      uptimeSeconds: time.uptime,
    };
  }

  async collectServices(): Promise<ServiceStatus[]> {
    if (this.watchedServices.length === 0) return [];
    const processes = await si.processes();
    const runningNames = new Set(processes.list.map((p) => p.name));
    return this.watchedServices.map((name) => ({
      name,
      state: runningNames.has(name) ? "running" : "stopped",
    }));
  }
}

function toGpuInfo(controllers: si.Systeminformation.GraphicsControllerData[], includeUtilization: boolean): GpuInfo[] {
  return controllers.map((c, index) => ({
    index,
    vendor: c.vendor || "unknown",
    model: c.model || "unknown",
    vramTotalBytes: c.vram ? c.vram * 1024 * 1024 : undefined,
    vramUsedBytes: includeUtilization && c.memoryUsed ? c.memoryUsed * 1024 * 1024 : undefined,
    utilizationPct: includeUtilization ? c.utilizationGpu ?? undefined : undefined,
    temperatureC: includeUtilization ? c.temperatureGpu ?? undefined : undefined,
  }));
}

function round(n: number | null | undefined): number | undefined {
  return typeof n === "number" ? Math.round(n * 10) / 10 : undefined;
}
