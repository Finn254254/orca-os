import type { StudioAgentConfig, StudioRun, StudioWorkflow } from "@orca/shared";
import type { SessionUser } from "../api.js";

export type StudioTab = "agents" | "workflows" | "runs";

interface SidebarProps {
  tab: StudioTab;
  onTabChange: (tab: StudioTab) => void;
  agentConfigs: StudioAgentConfig[];
  workflows: StudioWorkflow[];
  runs: StudioRun[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  user: SessionUser | null;
  onSignOut: () => void;
}

const TABS: { id: StudioTab; label: string }[] = [
  { id: "agents", label: "Agents" },
  { id: "workflows", label: "Workflows" },
  { id: "runs", label: "Runs" },
];

function itemLabel(tab: StudioTab, item: StudioAgentConfig | StudioWorkflow | StudioRun): string {
  if (tab === "runs") {
    const run = item as StudioRun;
    return `${run.kind === "agent" ? "Agent" : "Workflow"} · ${run.status}`;
  }
  return (item as StudioAgentConfig | StudioWorkflow).name;
}

export function Sidebar({ tab, onTabChange, agentConfigs, workflows, runs, selectedId, onSelect, onNew, onDelete, user, onSignOut }: SidebarProps) {
  const items: (StudioAgentConfig | StudioWorkflow | StudioRun)[] = tab === "agents" ? agentConfigs : tab === "workflows" ? workflows : runs;

  return (
    <div className="studio-sidebar">
      <div className="studio-sidebar-header">
        <span className="studio-brand">Orca Studio</span>
        <div className="studio-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`studio-tab${tab === t.id ? " active" : ""}`} onClick={() => onTabChange(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {tab !== "runs" && (
          <button className="secondary" onClick={onNew}>
            + New {tab === "agents" ? "agent" : "workflow"}
          </button>
        )}
      </div>
      <div className="studio-item-list">
        {items.length === 0 && <div className="muted studio-empty-list">Nothing here yet</div>}
        {items.map((item) => (
          <div key={item.id} className={`studio-item${item.id === selectedId ? " active" : ""}`} onClick={() => onSelect(item.id)}>
            <span className="studio-item-label">{itemLabel(tab, item)}</span>
            {tab !== "runs" && (
              <button
                className="studio-delete-btn"
                aria-label={`Delete ${itemLabel(tab, item)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(item.id);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="studio-sidebar-footer">
        <span className="muted">{user?.username}</span>
        <button className="secondary" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
