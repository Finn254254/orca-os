import { useState, type FormEvent } from "react";
import type { StudioRun } from "@orca/shared";
import { RunResult } from "./RunResult.js";

interface TestConsoleProps {
  onRun: (input: string) => Promise<StudioRun>;
}

export function TestConsole({ onRun }: TestConsoleProps) {
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<StudioRun | undefined>();
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || running) return;
    setRunning(true);
    setError(undefined);
    try {
      setResult(await onRun(input));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="studio-console">
      <div className="studio-console-label">Testing console</div>
      <form onSubmit={handleSubmit} className="studio-console-form">
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} placeholder="Test input…" disabled={running} />
        <button type="submit" disabled={running || !input.trim()}>
          {running ? "Running…" : "Run"}
        </button>
      </form>
      {error && <div className="error-text">{error}</div>}
      {result && <RunResult run={result} />}
    </div>
  );
}
