import { useEffect, useState, type FormEvent } from "react";
import type { StudioAgentConfig } from "@orca/shared";
import type { ModelOption } from "../api.js";

interface AgentConfigEditorProps {
  config: StudioAgentConfig | undefined;
  models: ModelOption[];
  onSave: (input: { name: string; systemPrompt: string; model: string; tools: string[] }) => Promise<void>;
  onDelete?: () => void;
}

export function AgentConfigEditor({ config, models, onSave, onDelete }: AgentConfigEditorProps) {
  const [name, setName] = useState(config?.name ?? "");
  const [systemPrompt, setSystemPrompt] = useState(config?.systemPrompt ?? "");
  const [model, setModel] = useState(config?.model ?? models[0]?.id ?? "");

  // `models` loads asynchronously and may still be empty on first mount
  // (e.g. right after selecting "+ New agent" before the models fetch
  // resolves) — default to the first one once it arrives, but only for a
  // new (unsaved) config with no selection yet, never overriding a saved
  // config's model or a choice the user already made.
  useEffect(() => {
    if (!config && !model && models[0]) setModel(models[0].id);
  }, [config, model, models]);
  const [toolsText, setToolsText] = useState((config?.tools ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const tools = toolsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await onSave({ name, systemPrompt, model, tools });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="studio-editor" onSubmit={handleSubmit}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Research Assistant" required />
      </label>
      <label>
        Model
        {models.length === 0 ? (
          <div className="muted">No models available — pull one from Model Manager first</div>
        ) : (
          <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model" required>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} ({m.owned_by})
              </option>
            ))}
          </select>
        )}
      </label>
      <label>
        System prompt
        <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={6} placeholder="You are a helpful assistant that…" required />
      </label>
      <label>
        Tools <span className="muted">(comma-separated names — declarative only, not yet executed)</span>
        <input value={toolsText} onChange={(e) => setToolsText(e.target.value)} placeholder="web_search, calculator" />
      </label>
      {error && <div className="error-text">{error}</div>}
      <div className="studio-editor-actions">
        <button type="submit" disabled={saving || !name || !systemPrompt || !model}>
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
