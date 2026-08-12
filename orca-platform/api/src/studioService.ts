import type { ChatMessage, StudioAgentConfig, StudioRun, StudioWorkflow } from "@orca/shared";
import { AgentConfigStore, type CreateAgentConfigInput, type UpdateAgentConfigInput } from "./studioAgentConfigStore.js";
import { RunStore } from "./studioRunStore.js";
import { WorkflowStore, type CreateWorkflowInput, type UpdateWorkflowInput } from "./studioWorkflowStore.js";

/** Narrow structural port onto chat inference — deliberately not a dependency on @orca/ai-gateway's full surface. */
export interface StudioChatRuntime {
  complete(model: string, messages: ChatMessage[]): Promise<string>;
}

export interface StudioServiceOptions {
  agentConfigs: AgentConfigStore;
  workflows: WorkflowStore;
  runs: RunStore;
  runtime: StudioChatRuntime;
  logger?: { warn: (...a: unknown[]) => void };
}

export class NotFoundError extends Error {}

/**
 * Orca Studio: saved agent configurations (system prompt + model + tool
 * list) and workflows (ordered pipelines of agent steps), plus a testing
 * console that runs either against the AI Gateway and records the result.
 * Tool *execution* is out of scope for this phase — `tools` is currently
 * declarative metadata attached to a config, not invoked — this needs a
 * real function-calling-capable runtime integration to do safely, tracked
 * as a known limitation (see docs/PROGRESS.md).
 */
export class StudioService {
  constructor(private readonly options: StudioServiceOptions) {}

  // ---- Agent configs ----

  createAgentConfig(userId: string, input: CreateAgentConfigInput): Promise<StudioAgentConfig> {
    return this.options.agentConfigs.create(userId, input);
  }

  listAgentConfigs(userId: string): StudioAgentConfig[] {
    return this.options.agentConfigs.listForUser(userId);
  }

  getOwnedAgentConfig(userId: string, id: string): StudioAgentConfig | undefined {
    const config = this.options.agentConfigs.get(id);
    return config && config.userId === userId ? config : undefined;
  }

  async updateAgentConfig(userId: string, id: string, patch: UpdateAgentConfigInput): Promise<StudioAgentConfig | undefined> {
    if (!this.getOwnedAgentConfig(userId, id)) return undefined;
    return this.options.agentConfigs.update(id, patch);
  }

  async deleteAgentConfig(userId: string, id: string): Promise<boolean> {
    if (!this.getOwnedAgentConfig(userId, id)) return false;
    return this.options.agentConfigs.delete(id);
  }

  // ---- Workflows ----

  createWorkflow(userId: string, input: CreateWorkflowInput): Promise<StudioWorkflow> {
    return this.options.workflows.create(userId, input);
  }

  listWorkflows(userId: string): StudioWorkflow[] {
    return this.options.workflows.listForUser(userId);
  }

  getOwnedWorkflow(userId: string, id: string): StudioWorkflow | undefined {
    const workflow = this.options.workflows.get(id);
    return workflow && workflow.userId === userId ? workflow : undefined;
  }

  async updateWorkflow(userId: string, id: string, patch: UpdateWorkflowInput): Promise<StudioWorkflow | undefined> {
    if (!this.getOwnedWorkflow(userId, id)) return undefined;
    return this.options.workflows.update(id, patch);
  }

  async deleteWorkflow(userId: string, id: string): Promise<boolean> {
    if (!this.getOwnedWorkflow(userId, id)) return false;
    return this.options.workflows.delete(id);
  }

  // ---- Runs ----

  listRuns(userId: string): StudioRun[] {
    return this.options.runs.listForUser(userId);
  }

  getOwnedRun(userId: string, id: string): StudioRun | undefined {
    const run = this.options.runs.get(id);
    return run && run.userId === userId ? run : undefined;
  }

  /** Runs a single saved agent config against `input` through the AI Gateway, recording a StudioRun. */
  async runAgent(userId: string, agentConfigId: string, input: string): Promise<StudioRun> {
    const config = this.getOwnedAgentConfig(userId, agentConfigId);
    if (!config) throw new NotFoundError("agent config not found");

    const run = await this.options.runs.create(userId, { kind: "agent", agentConfigId, input });
    const started = Date.now();
    try {
      const output = await this.options.runtime.complete(config.model, [
        { role: "system", content: config.systemPrompt },
        { role: "user", content: input },
      ]);
      const step = { agentConfigId, input, output, latencyMs: Date.now() - started };
      return (await this.options.runs.complete(run.id, { status: "succeeded", output, steps: [step] }))!;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const step = { agentConfigId, input, error: message, latencyMs: Date.now() - started };
      return (await this.options.runs.complete(run.id, { status: "failed", error: message, steps: [step] }))!;
    }
  }

  /**
   * Runs a saved workflow's steps in order, feeding each step's output as
   * the next step's input (a linear pipeline, not a general DAG — the MVP
   * scope this phase targets). Stops at the first failing step.
   */
  async runWorkflow(userId: string, workflowId: string, input: string): Promise<StudioRun> {
    const workflow = this.getOwnedWorkflow(userId, workflowId);
    if (!workflow) throw new NotFoundError("workflow not found");

    const run = await this.options.runs.create(userId, { kind: "workflow", workflowId, input });
    const steps: StudioRun["steps"] = [];
    let currentInput = input;

    for (const step of workflow.steps) {
      const config = this.getOwnedAgentConfig(userId, step.agentConfigId);
      if (!config) {
        const error = `agent config ${step.agentConfigId} not found`;
        steps.push({ agentConfigId: step.agentConfigId, input: currentInput, error, latencyMs: 0 });
        return (await this.options.runs.complete(run.id, { status: "failed", error, steps }))!;
      }

      const started = Date.now();
      try {
        const output = await this.options.runtime.complete(config.model, [
          { role: "system", content: config.systemPrompt },
          { role: "user", content: currentInput },
        ]);
        steps.push({ agentConfigId: step.agentConfigId, input: currentInput, output, latencyMs: Date.now() - started });
        currentInput = output;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        steps.push({ agentConfigId: step.agentConfigId, input: currentInput, error: message, latencyMs: Date.now() - started });
        return (await this.options.runs.complete(run.id, { status: "failed", error: message, steps }))!;
      }
    }

    return (await this.options.runs.complete(run.id, { status: "succeeded", output: currentInput, steps }))!;
  }
}
