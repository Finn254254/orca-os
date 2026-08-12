import { useCallback, useEffect, useState } from "react";
import type { StudioRun } from "@orca/shared";
import { runs as runsApi } from "../api.js";

export function useRuns() {
  const [items, setItems] = useState<StudioRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    try {
      setItems(await runsApi.list());
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

  return { runs: items, setRuns: setItems, loading, error, refresh };
}
