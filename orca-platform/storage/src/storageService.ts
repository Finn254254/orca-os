import type { ControlPort } from "./controlPort.js";
import type { StorageStore } from "./store.js";
import type { ClusterCapacity, StorageDeviceView, StorageLocation, StoragePool } from "./types.js";

/**
 * Centralized storage visibility. Device discovery/capacity/free-space
 * comes straight from each node's already-reported disk metrics (Orca
 * Agent already collects these, see agent/src/metrics/) — Storage adds no
 * new per-node polling, just aggregates what's already flowing through
 * Control. Pools and named locations (model/dataset/app-data/backup) are
 * this service's own registry.
 *
 * Health is a simple usage-threshold heuristic (>=90% warning, >=97%
 * critical) since SMART/hardware health isn't part of the metrics model
 * yet — a real signal to add once Hardware Daemon (Phase 15) exists.
 *
 * Distributed storage (pooling raw capacity across nodes into one
 * filesystem) is explicitly out of scope for this phase, per the build
 * instructions — this only tracks/labels where things live today.
 */
export class StorageService {
  constructor(
    private readonly control: ControlPort,
    private readonly store: StorageStore,
  ) {}

  async listDevices(): Promise<StorageDeviceView[]> {
    const nodes = await this.control.listNodes();
    const devices: StorageDeviceView[] = [];
    for (const node of nodes) {
      for (const disk of node.lastMetrics?.disks ?? []) {
        const usedPct = disk.totalBytes > 0 ? (disk.usedBytes / disk.totalBytes) * 100 : 0;
        devices.push({
          nodeId: node.id,
          nodeName: node.name,
          mount: disk.mount,
          device: disk.device,
          filesystem: disk.filesystem,
          totalBytes: disk.totalBytes,
          usedBytes: disk.usedBytes,
          freeBytes: Math.max(0, disk.totalBytes - disk.usedBytes),
          usedPct: Math.round(usedPct * 10) / 10,
          health: usedPct >= 97 ? "critical" : usedPct >= 90 ? "warning" : "healthy",
        });
      }
    }
    return devices;
  }

  async clusterCapacity(): Promise<ClusterCapacity> {
    const devices = await this.listDevices();
    const totalBytes = devices.reduce((sum, d) => sum + d.totalBytes, 0);
    const usedBytes = devices.reduce((sum, d) => sum + d.usedBytes, 0);
    return {
      totalBytes,
      usedBytes,
      freeBytes: Math.max(0, totalBytes - usedBytes),
      usedPct: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
      deviceCount: devices.length,
      nodeCount: new Set(devices.map((d) => d.nodeId)).size,
    };
  }

  listPools(): StoragePool[] {
    return this.store.listPools();
  }

  createPool(input: { name: string; description?: string; nodeIds: string[] }): Promise<StoragePool> {
    return this.store.createPool(input);
  }

  deletePool(id: string): Promise<boolean> {
    return this.store.deletePool(id);
  }

  listLocations(kind?: StorageLocation["kind"]): StorageLocation[] {
    return this.store.listLocations(kind);
  }

  createLocation(input: { kind: StorageLocation["kind"]; nodeId: string; path: string; label?: string }): Promise<StorageLocation> {
    return this.store.createLocation(input);
  }

  deleteLocation(id: string): Promise<boolean> {
    return this.store.deleteLocation(id);
  }
}
