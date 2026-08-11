import { EventEmitter } from "node:events";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  ClusterConfig,
  CommandRecord,
  CommandStatus,
  NodeCapabilities,
  NodeMetrics,
  ServiceStatus,
} from "@orca/shared";
import { decodeMessage, send } from "./protocol.js";

export interface MeshServerOptions {
  httpServer: HttpServer;
  path?: string;
  token: string;
  getClusterConfig: () => ClusterConfig;
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

interface MeshServerEvents {
  hello: (payload: { nodeId: string; name: string; group?: string; capabilities?: NodeCapabilities }) => void;
  heartbeat: (payload: { nodeId: string; metrics?: NodeMetrics; services?: ServiceStatus[] }) => void;
  commandResult: (payload: {
    nodeId: string;
    commandId: string;
    status: CommandStatus;
    result?: Record<string, unknown>;
    error?: string;
  }) => void;
  disconnect: (payload: { nodeId: string }) => void;
}

/**
 * Server-side of the Orca Mesh protocol. Runs alongside Orca Control's HTTP
 * server and accepts authenticated WebSocket connections from Orca Agents.
 */
export class MeshServer extends EventEmitter {
  private readonly wss: WebSocketServer;
  private readonly sockets = new Map<string, WebSocket>();
  private readonly noop = () => undefined;

  constructor(private readonly options: MeshServerOptions) {
    super();
    this.wss = new WebSocketServer({ server: options.httpServer, path: options.path ?? "/mesh" });
    this.wss.on("connection", (socket) => this.handleConnection(socket));
  }

  private log() {
    return this.options.logger ?? { info: this.noop, warn: this.noop, error: this.noop };
  }

  private handleConnection(socket: WebSocket): void {
    let nodeId: string | undefined;

    socket.on("message", (raw) => {
      const message = decodeMessage(raw.toString());
      if (!message) {
        send(socket, { type: "error", message: "invalid message" });
        return;
      }

      if (message.type === "hello") {
        if (message.token !== this.options.token) {
          send(socket, { type: "error", message: "unauthorized" });
          socket.close(4001, "unauthorized");
          return;
        }
        nodeId = message.nodeId;
        this.sockets.set(nodeId, socket);
        this.emit("hello", {
          nodeId: message.nodeId,
          name: message.name,
          group: message.group,
          capabilities: message.capabilities,
        });
        send(socket, { type: "ack", nodeId: message.nodeId, clusterConfig: this.options.getClusterConfig() });
        return;
      }

      if (!nodeId) {
        send(socket, { type: "error", message: "hello required before other messages" });
        return;
      }

      if (message.type === "heartbeat") {
        this.emit("heartbeat", { nodeId, metrics: message.metrics, services: message.services });
        return;
      }

      if (message.type === "command_result") {
        this.emit("commandResult", {
          nodeId,
          commandId: message.commandId,
          status: message.status,
          result: message.result,
          error: message.error,
        });
      }
    });

    socket.on("close", () => {
      if (nodeId) {
        this.sockets.delete(nodeId);
        this.emit("disconnect", { nodeId });
      }
    });

    socket.on("error", (err) => this.log().warn("mesh socket error", err));
  }

  isConnected(nodeId: string): boolean {
    const socket = this.sockets.get(nodeId);
    return !!socket && socket.readyState === socket.OPEN;
  }

  connectedNodeIds(): string[] {
    return [...this.sockets.keys()];
  }

  sendCommand(command: CommandRecord): boolean {
    const socket = this.sockets.get(command.nodeId);
    if (!socket) return false;
    send(socket, { type: "command", command });
    return true;
  }

  /**
   * Closes every open connection and stops the server. Waits for each
   * socket's "close" handler to run (which fires the "disconnect" event)
   * before resolving, so callers can safely persist final state right after.
   */
  async close(): Promise<void> {
    const closings = [...this.sockets.values()].map(
      (socket) =>
        new Promise<void>((resolve) => {
          if (socket.readyState === socket.CLOSED) {
            resolve();
            return;
          }
          socket.once("close", () => resolve());
          socket.close();
        }),
    );
    await Promise.all(closings);
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}

export interface MeshServer {
  on<K extends keyof MeshServerEvents>(event: K, listener: MeshServerEvents[K]): this;
  emit<K extends keyof MeshServerEvents>(event: K, ...args: Parameters<MeshServerEvents[K]>): boolean;
}
