import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentConfigEditor } from "./AgentConfigEditor.js";

const MODELS = [{ id: "llama3", owned_by: "ollama" }];

describe("AgentConfigEditor", () => {
  it("submits a new config with parsed tools", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AgentConfigEditor config={undefined} models={MODELS} onSave={onSave} />);

    fireEvent.change(screen.getByPlaceholderText("e.g. Research Assistant"), { target: { value: "Helper" } });
    fireEvent.change(screen.getByPlaceholderText("You are a helpful assistant that…"), { target: { value: "Be helpful" } });
    fireEvent.change(screen.getByPlaceholderText("web_search, calculator"), { target: { value: "search, calc " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({ name: "Helper", systemPrompt: "Be helpful", model: "llama3", tools: ["search", "calc"] });
  });

  it("pre-fills fields from an existing config and shows a delete button", () => {
    const onDelete = vi.fn();
    render(
      <AgentConfigEditor
        config={{
          id: "agentcfg_1",
          userId: "user_1",
          name: "Existing",
          systemPrompt: "s",
          model: "llama3",
          tools: ["x"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }}
        models={MODELS}
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByDisplayValue("Existing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalled();
  });
});
