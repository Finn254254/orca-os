import type { ModelOption } from "../api.js";

interface ModelPickerProps {
  models: ModelOption[];
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

export function ModelPicker({ models, value, onChange, disabled }: ModelPickerProps) {
  if (models.length === 0) {
    return <span className="muted">No models available — pull one from Model Manager first</span>;
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label="Model">
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.id} ({m.owned_by})
        </option>
      ))}
    </select>
  );
}
