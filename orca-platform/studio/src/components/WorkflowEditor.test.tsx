import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkflowEditor } from "./WorkflowEditor.js";

const AGENTS = [
  { id: "agentcfg_1", userId: "u", name: "Step A", systemPrompt: "s", model: "llama3", tools: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "agentcfg_2", userId: "u", name: "Step B", systemPrompt: "s", model: "llama3", tools: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
];

describe("WorkflowEditor", () => {
  it("adds a step and submits the ordered step list", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<WorkflowEditor workflow={undefined} agentConfigs={AGENTS} onSave={onSave} />);

    fireEvent.change(screen.getByPlaceholderText("e.g. Research then summarize"), { target: { value: "Pipeline" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({
      name: "Pipeline",
      steps: [{ agentConfigId: "agentcfg_1" }, { agentConfigId: "agentcfg_1" }],
    });
  });

  it("shows a message instead of a form when there are no agent configs yet", () => {
    render(<WorkflowEditor workflow={undefined} agentConfigs={[]} onSave={vi.fn()} />);
    expect(screen.getByText(/Create at least one agent config/)).toBeInTheDocument();
  });
});
