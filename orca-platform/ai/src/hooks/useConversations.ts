import { useCallback, useEffect, useState } from "react";
import type { Conversation } from "@orca/shared";
import { listConversations } from "../api.js";

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    try {
      const list = await listConversations();
      setConversations(list);
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

  return { conversations, setConversations, loading, error, refresh };
}
