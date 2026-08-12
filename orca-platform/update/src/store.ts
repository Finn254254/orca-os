import { join } from "node:path";
import { JsonStore, generateId, now, type Rollout, type UpdateManifest } from "@orca/shared";

interface UpdateState {
  manifests: Record<string, UpdateManifest>; // keyed by version
  rollouts: Record<string, Rollout>;
  commandIdByRolloutNode: Record<string, string>; // key: `${rolloutId}:${nodeId}`
}

export class UpdateStore {
  private readonly store: JsonStore<UpdateState>;

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "updates.json"), { manifests: {}, rollouts: {}, commandIdByRolloutNode: {} });
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  async saveManifest(manifest: UpdateManifest): Promise<UpdateManifest> {
    await this.store.mutate((s) => ({ ...s, manifests: { ...s.manifests, [manifest.version]: manifest } }));
    return manifest;
  }

  listManifests(): UpdateManifest[] {
    return Object.values(this.store.get().manifests).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getManifest(version: string): UpdateManifest | undefined {
    return this.store.get().manifests[version];
  }

  async createRollout(input: { manifest: UpdateManifest; targetNodeIds: string[]; strategy: Rollout["strategy"]; stagePct: number }): Promise<Rollout> {
    const rollout: Rollout = {
      id: generateId("rollout"),
      manifest: input.manifest,
      targetNodeIds: input.targetNodeIds,
      strategy: input.strategy,
      stagePct: input.stagePct,
      state: "pending",
      perNodeStatus: {},
      createdAt: now(),
      updatedAt: now(),
    };
    await this.store.mutate((s) => ({ ...s, rollouts: { ...s.rollouts, [rollout.id]: rollout } }));
    return rollout;
  }

  listRollouts(): Rollout[] {
    return Object.values(this.store.get().rollouts).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getRollout(id: string): Rollout | undefined {
    return this.store.get().rollouts[id];
  }

  async updateRollout(id: string, patch: Partial<Rollout>): Promise<Rollout | undefined> {
    const state = await this.store.mutate((s) => {
      const rollout = s.rollouts[id];
      if (!rollout) return s;
      return { ...s, rollouts: { ...s.rollouts, [id]: { ...rollout, ...patch, updatedAt: now() } } };
    });
    return state.rollouts[id];
  }

  async setNodeStatus(rolloutId: string, nodeId: string, status: Rollout["perNodeStatus"][string]): Promise<void> {
    await this.store.mutate((s) => {
      const rollout = s.rollouts[rolloutId];
      if (!rollout) return s;
      return {
        ...s,
        rollouts: { ...s.rollouts, [rolloutId]: { ...rollout, perNodeStatus: { ...rollout.perNodeStatus, [nodeId]: status }, updatedAt: now() } },
      };
    });
  }

  async setCommand(rolloutId: string, nodeId: string, commandId: string): Promise<void> {
    const key = `${rolloutId}:${nodeId}`;
    await this.store.mutate((s) => ({ ...s, commandIdByRolloutNode: { ...s.commandIdByRolloutNode, [key]: commandId } }));
  }

  getCommandId(rolloutId: string, nodeId: string): string | undefined {
    return this.store.get().commandIdByRolloutNode[`${rolloutId}:${nodeId}`];
  }

  async clearCommand(rolloutId: string, nodeId: string): Promise<void> {
    const key = `${rolloutId}:${nodeId}`;
    await this.store.mutate((s) => {
      const { [key]: _removed, ...rest } = s.commandIdByRolloutNode;
      return { ...s, commandIdByRolloutNode: rest };
    });
  }
}
