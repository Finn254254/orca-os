import type { ModelRecord, ModelRuntime } from "@orca/shared";
import type { RuntimeAdapter } from "./adapters/types.js";
import type { ModelStore } from "./store.js";

export interface ModelServiceOptions {
  store: ModelStore;
  adapters: Partial<Record<ModelRuntime, RuntimeAdapter>>;
  logger?: { warn: (...a: unknown[]) => void };
}

/**
 * Orca Model Manager: a registry over one or more runtime adapters
 * (Ollama, llama.cpp — see adapters/). Scope note: this phase manages
 * models for whatever runtime endpoint each adapter is configured against
 * (e.g. one Ollama instance); automatically discovering/routing to a
 * *specific* node's runtime across the cluster is AI Gateway/Scheduler
 * territory and not solved here yet — `nodeId` on a model record is
 * informational until that lands.
 */
export class ModelService {
  private readonly store: ModelStore;
  private readonly adapters: Partial<Record<ModelRuntime, RuntimeAdapter>>;
  private readonly log: { warn: (...a: unknown[]) => void };

  constructor(options: ModelServiceOptions) {
    this.store = options.store;
    this.adapters = options.adapters;
    this.log = options.logger ?? { warn: () => undefined };
  }

  listModels(): ModelRecord[] {
    return this.store.listModels();
  }

  getModel(id: string): ModelRecord | undefined {
    return this.store.getModel(id);
  }

  async pullModel(runtime: ModelRuntime, name: string): Promise<ModelRecord> {
    const adapter = this.adapters[runtime];
    if (!adapter) throw new Error(`no adapter configured for runtime "${runtime}"`);

    const model = await this.store.register({ name, runtime, state: "downloading" });
    await this.store.updateModel(model.id, { downloadProgressPct: 0 });

    void adapter
      .pullModel(name, (pct) => {
        void this.store.updateModel(model.id, { downloadProgressPct: Math.round(pct) });
      })
      .then(async () => {
        await this.store.updateModel(model.id, { state: "available", downloadProgressPct: 100 });
      })
      .catch(async (err) => {
        this.log.warn({ modelId: model.id, name, runtime, err }, "model pull failed");
        await this.store.updateModel(model.id, {
          state: "error",
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
      });

    return model;
  }

  async deleteModel(id: string): Promise<boolean> {
    const model = this.store.getModel(id);
    if (!model) return false;
    const adapter = this.adapters[model.runtime];
    if (adapter) {
      try {
        await adapter.deleteModel(model.name);
      } catch (err) {
        this.log.warn({ modelId: id, err }, "adapter delete failed; removing from registry anyway");
      }
    }
    return this.store.deleteModel(id);
  }

  /** Syncs the registry with what a runtime adapter reports is actually available. */
  async refreshFromRuntime(runtime: ModelRuntime): Promise<ModelRecord[]> {
    const adapter = this.adapters[runtime];
    if (!adapter) return [];
    const available = await adapter.listAvailable();
    const results: ModelRecord[] = [];
    for (const m of available) {
      results.push(await this.store.register({ name: m.name, runtime, format: m.format, sizeBytes: m.sizeBytes, state: "available" }));
    }
    return results;
  }
}
