import type { NodeStatus } from "@orca/shared";

export function StatusPill({ status }: { status: NodeStatus }) {
  return (
    <span className={`status-pill status-${status}`}>
      <span className="status-dot" />
      {status}
    </span>
  );
}
