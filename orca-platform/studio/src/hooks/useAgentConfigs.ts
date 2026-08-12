import { useCallback, useEffect, useState } from "react";
import type { StudioAgentConfig } from "@orca/shared";
import { agentConfigs } from "../api.js";

export function useAgentConfigs() {
  const [configs, setConfigs] = useState<StudioAgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    try {
      setConfigs(await agentConfigs.list());
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { configs, setConfigs, loading, error, refresh };
}
