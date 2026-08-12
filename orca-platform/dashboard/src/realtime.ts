import { useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "@orca/shared";
import { wsUrl } from "./api.js";

/**
 * Subscribes to Orca API's /ws realtime channel and reconnects with a
 * simple fixed backoff on disconnect. Returns the most recent events;
 * callers fold them into their own state as needed.
 */
export function useRealtime(onEvent: (event: RealtimeEvent) => void): "connecting" | "open" | "closed" {
  const [state, setState] = useState<"connecting" | "open" | "closed">("connecting");
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      setState("connecting");
      socket = new WebSocket(wsUrl());
      socket.onopen = () => setState("open");
      socket.onclose = () => {
        setState("closed");
        reconnectTimer = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket?.close();
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as RealtimeEvent;
          handlerRef.current(parsed);
        } catch {
          // ignore malformed frames
        }
      };
    }

    connect();
    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return state;
}
