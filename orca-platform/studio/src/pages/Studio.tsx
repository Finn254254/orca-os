import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AgentConfigEditor } from "../components/AgentConfigEditor.js";
import { RunResult } from "../components/RunResult.js";
import { Sidebar, type StudioTab } from "../components/Sidebar.js";
import { TestConsole } from "../components/TestConsole.js";
import { WorkflowEditor } from "../components/WorkflowEditor.js";
import { useAgentConfigs } from "../hooks/useAgentConfigs.js";
import { useRuns } from "../hooks/useRuns.js";
import { useWorkflows } from "../hooks/useWorkflows.js";
import { agentConfigs as agentConfigsApi, clearSession, getStoredUser, listAvailableModels, workflows as workflowsApi, type ModelOption } from "../api.js";

export function Studio() {
  const navigate = useNavigate();
  const user = getStoredUser();
  const { configs, setConfigs, refresh: refreshAgents } = useAgentConfigs();
  const { workflows: workflowList, setWorkflows, refresh: refreshWorkflows } = useWorkflows();
  const { runs, refresh: refreshRuns } = useRuns();

  const [tab, setTab] = useState<StudioTab>("agents");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    listAvailableModels()
      .then(setModels)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  function changeTab(next: StudioTab) {
    setTab(next);
    setSelectedId(undefined);
  }

  function signOut() {
    clearSession();
    navigate("/login");
  }

  const selectedConfig = tab === "agents" ? configs.find((c) => c.id === selectedId) : undefined;
  const selectedWorkflow = tab === "workflows" ? workflowList.find((w) => w.id === selectedId) : undefined;
  const selectedRun = tab === "runs" ? runs.find((r) => r.id === selectedId) : undefined;

  async function handleDelete(id: string) {
    try {
      if (tab === "agents") {
        await agentConfigsApi.remove(id);
        setConfigs((prev) => prev.filter((c) => c.id !== id));
      } else if (tab === "workflows") {
        await workflowsApi.remove(id);
        setWorkflows((prev) => prev.filter((w) => w.id !== id));
      }
      if (selectedId === id) setSelectedId(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="studio-shell">
      <Sidebar
        tab={tab}
        onTabChange={changeTab}
        agentConfigs={configs}
        workflows={workflowList}
        runs={runs}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onNew={() => setSelectedId(undefined)}
        onDelete={handleDelete}
        user={user}
        onSignOut={signOut}
      />
      <div className="studio-main">
        {error && <div className="error-text studio-error">{error}</div>}

        {tab === "agents" && (
          <>
            <AgentConfigEditor
              key={selectedConfig?.id ?? "new"}
              config={selectedConfig}
              models={models}
              onDelete={selectedConfig ? () => handleDelete(selectedConfig.id) : undefined}
              onSave={async (input) => {
                const saved = selectedConfig
                  ? await agentConfigsApi.update(selectedConfig.id, input)
                  : await agentConfigsApi.create(input);
                await refreshAgents();
                setSelectedId(saved.id);
              }}
            />
            {selectedConfig && (
              <TestConsole
                onRun={async (input) => {
                  const run = await agentConfigsApi.run(selectedConfig.id, input);
                  void refreshRuns();
                  return run;
                }}
              />
            )}
          </>
        )}

        {tab === "workflows" && (
          <>
            <WorkflowEditor
              key={selectedWorkflow?.id ?? "new"}
              workflow={selectedWorkflow}
              agentConfigs={configs}
              onDelete={selectedWorkflow ? () => handleDelete(selectedWorkflow.id) : undefined}
              onSave={async (input) => {
                const saved = selectedWorkflow
                  ? await workflowsApi.update(selectedWorkflow.id, input)
                  : await workflowsApi.create(input);
                await refreshWorkflows();
                setSelectedId(saved.id);
              }}
            />
            {selectedWorkflow && (
              <TestConsole
                onRun={async (input) => {
                  const run = await workflowsApi.run(selectedWorkflow.id, input);
                  void refreshRuns();
                  return run;
                }}
              />
            )}
          </>
        )}

        {tab === "runs" && (
          <>
            {!selectedRun && <div className="muted">Select a run from the sidebar to see its details.</div>}
            {selectedRun && <RunResult run={selectedRun} />}
          </>
        )}
      </div>
    </div>
  );
}
