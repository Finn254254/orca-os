import { join } from "node:path";
import { JsonStore, generateId, now, type ModelRecord, type ModelRuntime, type ModelState } from "@orca/shared";

interface ModelsState {
  models: Record<string, ModelRecord>;
}

export class ModelStore {
  private readonly store: JsonStore<ModelsState>;

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "models.json"), { models: {} });
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  listModels(): ModelRecord[] {
    return Object.values(this.store.get().models).sort((a, b) => a.name.localeCompare(b.name));
  }

  getModel(id: string): ModelRecord | undefined {
    return this.store.get().models[id];
  }

  findByName(name: string, runtime: ModelRuntime): ModelRecord | undefined {
    return Object.values(this.store.get().models).find((m) => m.name === name && m.runtime === runtime);
  }

  async register(input: {
    name: string;
    runtime: ModelRuntime;
    format?: string;
    sizeBytes?: number;
    nodeId?: string;
    storagePath?: string;
    state?: ModelState;
    metadata?: Record<string, unknown>;
  }): Promise<ModelRecord> {
    const existing = this.findByName(input.name, input.runtime);
    const model: ModelRecord = {
      id: existing?.id ?? generateId("model"),
      name: input.name,
      runtime: input.runtime,
      format: input.format,
      sizeBytes: input.sizeBytes,
      state: input.state ?? "not_downloaded",
      nodeId: input.nodeId,
      storagePath: input.storagePath,
      metadata: input.metadata ?? {},
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };
    await this.store.mutate((s) => ({ models: { ...s.models, [model.id]: model } }));
    return model;
  }

  async updateModel(id: string, patch: Partial<ModelRecord>): Promise<ModelRecord | undefined> {
    const state = await this.store.mutate((s) => {
      const model = s.models[id];
      if (!model) return s;
      return { models: { ...s.models, [id]: { ...model, ...patch, updatedAt: now() } } };
    });
    return state.models[id];
  }

  async deleteModel(id: string): Promise<boolean> {
    if (!this.store.get().models[id]) return false;
    await this.store.mutate((s) => {
      const { [id]: _removed, ...rest } = s.models;
      return { models: rest };
    });
    return true;
  }
}
