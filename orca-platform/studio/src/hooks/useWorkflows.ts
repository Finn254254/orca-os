import { useCallback, useEffect, useState } from "react";
import type { StudioWorkflow } from "@orca/shared";
import { workflows } from "../api.js";

export function useWorkflows() {
  const [items, setItems] = useState<StudioWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    try {
      setItems(await workflows.list());
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

  return { workflows: items, setWorkflows: setItems, loading, error, refresh };
}
