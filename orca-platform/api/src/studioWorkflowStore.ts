import { join } from "node:path";
import { JsonStore, generateId, now, type StudioWorkflow, type StudioWorkflowStep } from "@orca/shared";

interface WorkflowsState {
  workflows: Record<string, StudioWorkflow>;
}

export interface CreateWorkflowInput {
  name: string;
  steps: StudioWorkflowStep[];
}

export type UpdateWorkflowInput = Partial<CreateWorkflowInput>;

/** Per-user registry of saved Orca Studio workflows — ordered pipelines of agent config steps. */
export class WorkflowStore {
  private readonly store: JsonStore<WorkflowsState>;

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "workflows.json"), { workflows: {} });
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  async create(userId: string, input: CreateWorkflowInput): Promise<StudioWorkflow> {
    const workflow: StudioWorkflow = {
      id: generateId("workflow"),
      userId,
      name: input.name,
      steps: input.steps,
      createdAt: now(),
      updatedAt: now(),
    };
    await this.store.mutate((s) => ({ workflows: { ...s.workflows, [workflow.id]: workflow } }));
    return workflow;
  }

  listForUser(userId: string): StudioWorkflow[] {
    return Object.values(this.store.get().workflows)
      .filter((w) => w.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): StudioWorkflow | undefined {
    return this.store.get().workflows[id];
  }

  async update(id: string, patch: UpdateWorkflowInput): Promise<StudioWorkflow | undefined> {
    const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const state = await this.store.mutate((s) => {
      const workflow = s.workflows[id];
      if (!workflow) return s;
      return { workflows: { ...s.workflows, [id]: { ...workflow, ...definedPatch, updatedAt: now() } } };
    });
    return state.workflows[id];
  }

  async delete(id: string): Promise<boolean> {
    if (!this.store.get().workflows[id]) return false;
    await this.store.mutate((s) => {
      const { [id]: _removed, ...rest } = s.workflows;
      return { workflows: rest };
    });
    return true;
  }
}
