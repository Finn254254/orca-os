import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { ClusterConfig, CommandRecord, CommandStatus, NodeCapabilities, NodeMetrics, ServiceStatus } from "@orca/shared";
import { decodeMessage, send } from "./protocol.js";

export interface MeshClientOptions {
  url: string;
  token: string;
  nodeId: string;
  name: string;
  group?: string;
  capabilities?: NodeCapabilities;
  heartbeatIntervalMs?: number;
  minReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

interface MeshClientEvents {
  open: () => void;
  close: () => void;
  ack: (clusterConfig?: ClusterConfig) => void;
  command: (command: CommandRecord) => void;
  error: (err: unknown) => void;
}

/**
 * Client-side of the Orca Mesh protocol, used by Orca Agent to connect to
 * Orca Control. Handles authentication, heartbeats, and reconnection with
 * exponential backoff so a restarted or briefly-partitioned Control node
 * doesn't require the agent to be restarted too.
 */
export class MeshClient extends EventEmitter {
  private socket: WebSocket | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectDelayMs: number;
  private closed = false;
  private connected = false;

  constructor(private readonly options: MeshClientOptions) {
    super();
    this.reconnectDelayMs = options.minReconnectDelayMs ?? 1000;
  }

  private log() {
    return (
      this.options.logger ?? {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      }
    );
  }

  start(): void {
    this.closed = false;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const socket = new WebSocket(this.options.url);
    this.socket = socket;

    socket.on("open", () => {
      this.connected = true;
      this.reconnectDelayMs = this.options.minReconnectDelayMs ?? 1000;
      send(socket, {
        type: "hello",
        token: this.options.token,
        nodeId: this.options.nodeId,
        name: this.options.name,
        group: this.options.group,
        capabilities: this.options.capabilities,
      });
      this.emit("open");
    });

    socket.on("message", (raw) => {
      const message = decodeMessage(raw.toString());
      if (!message) return;
      if (message.type === "ack") {
        this.emit("ack", message.clusterConfig);
      } else if (message.type === "command") {
        this.emit("command", message.command);
      } else if (message.type === "error") {
        this.log().warn("mesh client received error", message.message);
      }
    });

    socket.on("close", () => {
      this.connected = false;
      this.emit("close");
      this.scheduleReconnect();
    });

    socket.on("error", (err) => {
      this.emit("error", err);
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    clearTimeout(this.reconnectTimer);
    const max = this.options.maxReconnectDelayMs ?? 15000;
    const jitter = Math.random() * 0.3 * this.reconnectDelayMs;
    const delay = Math.min(this.reconnectDelayMs + jitter, max);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, max);
  }

  isConnected(): boolean {
    return this.connected;
  }

  sendHeartbeat(metrics?: NodeMetrics, services?: ServiceStatus[]): void {
    if (!this.socket || !this.connected) return;
    send(this.socket, { type: "heartbeat", nodeId: this.options.nodeId, metrics, services });
  }

  sendCommandResult(commandId: string, status: CommandStatus, result?: Record<string, unknown>, error?: string): void {
    if (!this.socket || !this.connected) return;
    send(this.socket, {
      type: "command_result",
      nodeId: this.options.nodeId,
      commandId,
      status,
      result,
      error,
    });
  }

  stop(): void {
    this.closed = true;
    clearTimeout(this.heartbeatTimer);
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}

export interface MeshClient {
  on<K extends keyof MeshClientEvents>(event: K, listener: MeshClientEvents[K]): this;
  emit<K extends keyof MeshClientEvents>(event: K, ...args: Parameters<MeshClientEvents[K]>): boolean;
}
