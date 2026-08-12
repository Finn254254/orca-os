import { useState, type FormEvent } from "react";
import type { StudioAgentConfig, StudioWorkflow, StudioWorkflowStep } from "@orca/shared";

interface WorkflowEditorProps {
  workflow: StudioWorkflow | undefined;
  agentConfigs: StudioAgentConfig[];
  onSave: (input: { name: string; steps: StudioWorkflowStep[] }) => Promise<void>;
  onDelete?: () => void;
}

export function WorkflowEditor({ workflow, agentConfigs, onSave, onDelete }: WorkflowEditorProps) {
  const [name, setName] = useState(workflow?.name ?? "");
  const [steps, setSteps] = useState<StudioWorkflowStep[]>(
    workflow?.steps ?? (agentConfigs[0] ? [{ agentConfigId: agentConfigs[0].id }] : []),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function updateStep(index: number, agentConfigId: string) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, agentConfigId } : s)));
  }

  function addStep() {
    if (!agentConfigs[0]) return;
    setSteps((prev) => [...prev, { agentConfigId: agentConfigs[0].id }]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function moveStep(index: number, direction: -1 | 1) {
    setSteps((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await onSave({ name, steps });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (agentConfigs.length === 0) {
    return <div className="muted studio-editor">Create at least one agent config before building a workflow.</div>;
  }

  return (
    <form className="studio-editor" onSubmit={handleSubmit}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Research then summarize" required />
      </label>
      <div className="studio-steps">
        <div className="studio-steps-label">Steps (run in order, each step's output feeds the next step's input)</div>
        {steps.map((step, index) => (
          <div className="studio-step-row" key={index}>
            <span className="studio-step-index">{index + 1}</span>
            <select value={step.agentConfigId} onChange={(e) => updateStep(index, e.target.value)} aria-label={`Step ${index + 1} agent`}>
              {agentConfigs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="button" className="secondary" onClick={() => moveStep(index, -1)} disabled={index === 0} aria-label="Move step up">
              ↑
            </button>
            <button type="button" className="secondary" onClick={() => moveStep(index, 1)} disabled={index === steps.length - 1} aria-label="Move step down">
              ↓
            </button>
            <button type="button" className="studio-delete-btn" onClick={() => removeStep(index)} aria-label="Remove step" disabled={steps.length === 1}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className="secondary" onClick={addStep}>
          + Add step
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="studio-editor-actions">
        <button type="submit" disabled={saving || !name || steps.length === 0}>
          {saving ? "Saving…" : "Save"}
        </button>
        {onDelete && (
          <button type="button" className="secondary" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
