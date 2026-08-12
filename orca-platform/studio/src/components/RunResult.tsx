import type { StudioRun } from "@orca/shared";

export function RunResult({ run }: { run: StudioRun }) {
  return (
    <div className={`studio-console-result studio-console-result-${run.status}`}>
      <div className="studio-console-result-header">
        <span className={`status-pill status-${run.status === "succeeded" ? "online" : run.status === "failed" ? "critical" : "degraded"}`}>
          {run.status}
        </span>
        <span className="muted">{run.kind}</span>
      </div>
      <div className="studio-console-output-label">Input</div>
      <pre className="raw">{run.input}</pre>
      {run.steps.length > 1 && (
        <div className="studio-console-steps">
          {run.steps.map((step, i) => (
            <div key={i} className="studio-console-step">
              <div className="studio-console-step-header">
                Step {i + 1} · {step.latencyMs}ms
              </div>
              {step.output && <pre className="raw">{step.output}</pre>}
              {step.error && <div className="error-text">{step.error}</div>}
            </div>
          ))}
        </div>
      )}
      {run.output && (
        <>
          <div className="studio-console-output-label">Output</div>
          <pre className="raw">{run.output}</pre>
        </>
      )}
      {run.error && <div className="error-text">{run.error}</div>}
    </div>
  );
}
