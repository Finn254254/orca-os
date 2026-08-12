import { join } from "node:path";
import { JsonStore, generateId, now } from "@orca/shared";
import type { StorageLocation, StoragePool } from "./types.js";

interface StorageState {
  pools: Record<string, StoragePool>;
  locations: Record<string, StorageLocation>;
}

export class StorageStore {
  private readonly store: JsonStore<StorageState>;

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "storage.json"), { pools: {}, locations: {} });
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  listPools(): StoragePool[] {
    return Object.values(this.store.get().pools).sort((a, b) => a.name.localeCompare(b.name));
  }

  async createPool(input: { name: string; description?: string; nodeIds: string[] }): Promise<StoragePool> {
    const pool: StoragePool = { id: generateId("pool"), createdAt: now(), ...input };
    await this.store.mutate((s) => ({ ...s, pools: { ...s.pools, [pool.id]: pool } }));
    return pool;
  }

  async deletePool(id: string): Promise<boolean> {
    if (!this.store.get().pools[id]) return false;
    await this.store.mutate((s) => {
      const { [id]: _removed, ...rest } = s.pools;
      return { ...s, pools: rest };
    });
    return true;
  }

  listLocations(kind?: StorageLocation["kind"]): StorageLocation[] {
    const all = Object.values(this.store.get().locations);
    return (kind ? all.filter((l) => l.kind === kind) : all).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createLocation(input: { kind: StorageLocation["kind"]; nodeId: string; path: string; label?: string }): Promise<StorageLocation> {
    const location: StorageLocation = { id: generateId("loc"), createdAt: now(), ...input };
    await this.store.mutate((s) => ({ ...s, locations: { ...s.locations, [location.id]: location } }));
    return location;
  }

  async deleteLocation(id: string): Promise<boolean> {
    if (!this.store.get().locations[id]) return false;
    await this.store.mutate((s) => {
      const { [id]: _removed, ...rest } = s.locations;
      return { ...s, locations: rest };
    });
    return true;
  }
}
