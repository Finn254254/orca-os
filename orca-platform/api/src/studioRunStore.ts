import { join } from "node:path";
import { JsonStore, generateId, now, type StudioRun, type StudioRunStepResult } from "@orca/shared";

interface RunsState {
  runs: Record<string, StudioRun>;
}

export interface CreateRunInput {
  kind: "agent" | "workflow";
  agentConfigId?: string;
  workflowId?: string;
  input: string;
}

/** Per-user history of Orca Studio testing-console executions (single agent or full workflow). */
export class RunStore {
  private readonly store: JsonStore<RunsState>;

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "runs.json"), { runs: {} });
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  async create(userId: string, input: CreateRunInput): Promise<StudioRun> {
    const run: StudioRun = {
      id: generateId("run"),
      userId,
      kind: input.kind,
      agentConfigId: input.agentConfigId,
      workflowId: input.workflowId,
      input: input.input,
      status: "running",
      steps: [],
      createdAt: now(),
    };
    await this.store.mutate((s) => ({ runs: { ...s.runs, [run.id]: run } }));
    return run;
  }

  listForUser(userId: string): StudioRun[] {
    return Object.values(this.store.get().runs)
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): StudioRun | undefined {
    return this.store.get().runs[id];
  }

  async complete(
    id: string,
    patch: { status: "succeeded" | "failed"; output?: string; error?: string; steps: StudioRunStepResult[] },
  ): Promise<StudioRun | undefined> {
    const state = await this.store.mutate((s) => {
      const run = s.runs[id];
      if (!run) return s;
      return { runs: { ...s.runs, [id]: { ...run, ...patch, completedAt: now() } } };
    });
    return state.runs[id];
  }
}
