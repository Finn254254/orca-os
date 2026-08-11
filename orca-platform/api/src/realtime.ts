import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { RealtimeEvent } from "@orca/shared";
import type { ControlClient } from "./controlClient.js";

export interface RealtimeHub {
  broadcast: (event: RealtimeEvent) => void;
  stopPolling: () => void;
  close: () => void;
}

/**
 * Realtime channel for the Dashboard/CLI/apps: a WebSocket at /ws that
 * broadcasts node and metrics changes. Sourced by polling Orca Control on a
 * short interval and diffing against the last-seen snapshot — a
 * deliberately simple MVP approach (see build instructions: reliable MVP
 * over complicated infra). Job/log/alert channels will broadcast on this
 * same hub once Compute/Backup/etc. exist to produce them.
 */
export function createRealtimeHub(httpServer: HttpServer, control: ControlClient, pollIntervalMs: number): RealtimeHub {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Set<WebSocket>();

  wss.on("connection", (socket) => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
  });

  function broadcast(event: RealtimeEvent): void {
    const payload = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  let lastSeen = new Map<string, { status: string; metricsTimestamp?: string }>();

  const interval = setInterval(async () => {
    try {
      const nodes = await control.listNodes();
      const seenIds = new Set<string>();
      for (const node of nodes) {
        seenIds.add(node.id);
        const prev = lastSeen.get(node.id);
        if (!prev) {
          broadcast({ channel: "node", event: "registered", data: node });
        } else if (prev.status !== node.status) {
          broadcast({ channel: "node", event: "status_changed", data: node });
        }
        if (node.lastMetrics && node.lastMetrics.timestamp !== prev?.metricsTimestamp) {
          broadcast({ channel: "metrics", event: "updated", data: { nodeId: node.id, metrics: node.lastMetrics } });
        }
        lastSeen.set(node.id, { status: node.status, metricsTimestamp: node.lastMetrics?.timestamp });
      }
      for (const id of lastSeen.keys()) {
        if (!seenIds.has(id)) lastSeen.delete(id);
      }
    } catch {
      // Control transiently unreachable; next poll will retry. Nothing to broadcast.
    }
  }, pollIntervalMs);
  interval.unref?.();

  return {
    broadcast,
    stopPolling: () => clearInterval(interval),
    close: () => {
      clearInterval(interval);
      for (const client of clients) client.close();
      wss.close();
    },
  };
}
