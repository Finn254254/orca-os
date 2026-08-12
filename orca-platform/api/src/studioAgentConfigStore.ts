import { join } from "node:path";
import { JsonStore, generateId, now, type StudioAgentConfig } from "@orca/shared";

interface AgentConfigsState {
  agentConfigs: Record<string, StudioAgentConfig>;
}

export interface CreateAgentConfigInput {
  name: string;
  systemPrompt: string;
  model: string;
  tools?: string[];
}

export type UpdateAgentConfigInput = Partial<CreateAgentConfigInput>;

/** Per-user registry of saved Orca Studio agent configurations (system prompt + model + tool list). */
export class AgentConfigStore {
  private readonly store: JsonStore<AgentConfigsState>;

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "agent-configs.json"), { agentConfigs: {} });
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  async create(userId: string, input: CreateAgentConfigInput): Promise<StudioAgentConfig> {
    const config: StudioAgentConfig = {
      id: generateId("agentcfg"),
      userId,
      name: input.name,
      systemPrompt: input.systemPrompt,
      model: input.model,
      tools: input.tools ?? [],
      createdAt: now(),
      updatedAt: now(),
    };
    await this.store.mutate((s) => ({ agentConfigs: { ...s.agentConfigs, [config.id]: config } }));
    return config;
  }

  listForUser(userId: string): StudioAgentConfig[] {
    return Object.values(this.store.get().agentConfigs)
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): StudioAgentConfig | undefined {
    return this.store.get().agentConfigs[id];
  }

  async update(id: string, patch: UpdateAgentConfigInput): Promise<StudioAgentConfig | undefined> {
    const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const state = await this.store.mutate((s) => {
      const config = s.agentConfigs[id];
      if (!config) return s;
      return { agentConfigs: { ...s.agentConfigs, [id]: { ...config, ...definedPatch, updatedAt: now() } } };
    });
    return state.agentConfigs[id];
  }

  async delete(id: string): Promise<boolean> {
    if (!this.store.get().agentConfigs[id]) return false;
    await this.store.mutate((s) => {
      const { [id]: _removed, ...rest } = s.agentConfigs;
      return { agentConfigs: rest };
    });
    return true;
  }
}
