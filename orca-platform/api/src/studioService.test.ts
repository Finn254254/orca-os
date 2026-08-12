import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "@orca/shared";
import { AgentConfigStore } from "./studioAgentConfigStore.js";
import { RunStore } from "./studioRunStore.js";
import { NotFoundError, StudioService, type StudioChatRuntime } from "./studioService.js";
import { WorkflowStore } from "./studioWorkflowStore.js";

class FakeRuntime implements StudioChatRuntime {
  calls: { model: string; messages: ChatMessage[] }[] = [];
  constructor(private readonly respond: (model: string, messages: ChatMessage[]) => string | Error) {}

  async complete(model: string, messages: ChatMessage[]): Promise<string> {
    this.calls.push({ model, messages });
    const result = this.respond(model, messages);
    if (result instanceof Error) throw result;
    return result;
  }
}

describe("StudioService", () => {
  let dir: string;
  let agentConfigs: AgentConfigStore;
  let workflows: WorkflowStore;
  let runs: RunStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-studio-"));
    agentConfigs = new AgentConfigStore(dir);
    await agentConfigs.init();
    workflows = new WorkflowStore(dir);
    await workflows.init();
    runs = new RunStore(dir);
    await runs.init();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  function makeService(runtime: StudioChatRuntime) {
    return new StudioService({ agentConfigs, workflows, runs, runtime });
  }

  it("creates, lists, updates, and deletes agent configs scoped to a user", async () => {
    const service = makeService(new FakeRuntime(() => "unused"));
    const config = await service.createAgentConfig("user_1", { name: "Helper", systemPrompt: "Be helpful", model: "llama3" });
    expect(config.tools).toEqual([]);

    expect(service.listAgentConfigs("user_1")).toHaveLength(1);
    expect(service.listAgentConfigs("user_2")).toHaveLength(0);

    const updated = await service.updateAgentConfig("user_1", config.id, { name: "Renamed" });
    expect(updated?.name).toBe("Renamed");
    expect(updated?.systemPrompt).toBe("Be helpful"); // untouched fields survive a partial update

    // Another user can't see, update, or delete it.
    expect(service.getOwnedAgentConfig("user_2", config.id)).toBeUndefined();
    expect(await service.updateAgentConfig("user_2", config.id, { name: "Hijacked" })).toBeUndefined();
    expect(await service.deleteAgentConfig("user_2", config.id)).toBe(false);

    expect(await service.deleteAgentConfig("user_1", config.id)).toBe(true);
    expect(service.listAgentConfigs("user_1")).toHaveLength(0);
  });

  it("runs a single agent config and records a succeeded run", async () => {
    const runtime = new FakeRuntime((model, messages) => {
      expect(model).toBe("llama3");
      expect(messages[0]).toEqual({ role: "system", content: "Be terse" });
      expect(messages[1]).toEqual({ role: "user", content: "hello" });
      return "hi there";
    });
    const service = makeService(runtime);
    const config = await service.createAgentConfig("user_1", { name: "Terse", systemPrompt: "Be terse", model: "llama3" });

    const run = await service.runAgent("user_1", config.id, "hello");
    expect(run.status).toBe("succeeded");
    expect(run.output).toBe("hi there");
    expect(run.steps).toHaveLength(1);
    expect(run.completedAt).toBeDefined();

    expect(service.listRuns("user_1")).toHaveLength(1);
    expect(service.getOwnedRun("user_2", run.id)).toBeUndefined();
  });

  it("records a failed run when the runtime throws", async () => {
    const runtime = new FakeRuntime(() => new Error("model unreachable"));
    const service = makeService(runtime);
    const config = await service.createAgentConfig("user_1", { name: "Broken", systemPrompt: "x", model: "llama3" });

    const run = await service.runAgent("user_1", config.id, "hello");
    expect(run.status).toBe("failed");
    expect(run.error).toBe("model unreachable");
    expect(run.steps[0].error).toBe("model unreachable");
  });

  it("throws NotFoundError running an agent config that isn't the caller's", async () => {
    const service = makeService(new FakeRuntime(() => "x"));
    const config = await service.createAgentConfig("user_1", { name: "Mine", systemPrompt: "x", model: "llama3" });
    await expect(service.runAgent("user_2", config.id, "hello")).rejects.toThrow(NotFoundError);
  });

  it("chains a workflow's steps, feeding each output into the next input", async () => {
    const runtime = new FakeRuntime((_model, messages) => `[processed] ${messages[1].content}`);
    const service = makeService(runtime);
    const step1 = await service.createAgentConfig("user_1", { name: "Step1", systemPrompt: "s1", model: "llama3" });
    const step2 = await service.createAgentConfig("user_1", { name: "Step2", systemPrompt: "s2", model: "llama3" });
    const workflow = await service.createWorkflow("user_1", {
      name: "Pipeline",
      steps: [{ agentConfigId: step1.id }, { agentConfigId: step2.id }],
    });

    const run = await service.runWorkflow("user_1", workflow.id, "raw input");
    expect(run.status).toBe("succeeded");
    expect(run.steps).toHaveLength(2);
    expect(run.steps[0].input).toBe("raw input");
    expect(run.steps[0].output).toBe("[processed] raw input");
    expect(run.steps[1].input).toBe("[processed] raw input");
    expect(run.output).toBe("[processed] [processed] raw input");
  });

  it("stops a workflow at the first failing step and doesn't run later steps", async () => {
    let calls = 0;
    const runtime = new FakeRuntime(() => {
      calls++;
      return new Error("boom");
    });
    const service = makeService(runtime);
    const step1 = await service.createAgentConfig("user_1", { name: "Step1", systemPrompt: "s1", model: "llama3" });
    const step2 = await service.createAgentConfig("user_1", { name: "Step2", systemPrompt: "s2", model: "llama3" });
    const workflow = await service.createWorkflow("user_1", {
      name: "Pipeline",
      steps: [{ agentConfigId: step1.id }, { agentConfigId: step2.id }],
    });

    const run = await service.runWorkflow("user_1", workflow.id, "raw input");
    expect(run.status).toBe("failed");
    expect(run.steps).toHaveLength(1);
    expect(calls).toBe(1);
  });
});
