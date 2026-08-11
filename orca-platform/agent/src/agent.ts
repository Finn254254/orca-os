import { MeshClient } from "@orca/mesh";
import type { Logger } from "@orca/shared";
import { executeCommand } from "./commands.js";
import type { AgentConfig } from "./config.js";
import type { MetricsProvider } from "./metrics/types.js";

export interface OrcaAgentOptions {
  config: AgentConfig;
  nodeId: string;
  metrics: MetricsProvider;
  logger: Logger;
}

/**
 * Orca Agent: the per-node daemon. Registers with Orca Control, sends
 * periodic heartbeats with host metrics, and executes commands Control
 * dispatches to this node.
 */
export class OrcaAgent {
  private client: MeshClient | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private heartbeatIntervalMs: number;

  constructor(private readonly options: OrcaAgentOptions) {
    this.heartbeatIntervalMs = options.config.heartbeatIntervalMs;
  }

  async start(): Promise<void> {
    const { logger, config } = this.options;
    const capabilities = await this.options.metrics.collectCapabilities();

    const client = new MeshClient({
      url: config.controlUrl,
      token: config.clusterToken,
      nodeId: this.options.nodeId,
      name: config.nodeName,
      group: config.nodeGroup,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      capabilities,
      logger,
    });
    this.client = client;

    client.on("open", () => logger.info({ url: config.controlUrl }, "connected to orca-control"));
    client.on("close", () => {
      logger.warn("disconnected from orca-control, will retry");
      this.stopHeartbeatLoop();
    });
    client.on("error", (err) => logger.warn({ err }, "mesh client error"));
    client.on("ack", (clusterConfig) => {
      if (clusterConfig?.heartbeatIntervalMs) this.heartbeatIntervalMs = clusterConfig.heartbeatIntervalMs;
      logger.info({ clusterName: clusterConfig?.clusterName }, "registered with orca-control");
      this.startHeartbeatLoop();
    });
    client.on("command", async (command) => {
      logger.info({ commandId: command.id, type: command.type }, "executing command");
      const outcome = await executeCommand(command, config);
      client.sendCommandResult(command.id, outcome.status, outcome.result, outcome.error);
    });

    client.start();
  }

  private startHeartbeatLoop(): void {
    this.stopHeartbeatLoop();
    const send = async () => {
      const [metrics, services] = await Promise.all([
        this.options.metrics.collectMetrics(),
        this.options.metrics.collectServices(),
      ]);
      this.client?.sendHeartbeat(metrics, services);
    };
    void send();
    this.heartbeatTimer = setInterval(() => void send(), this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeatLoop(): void {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  stop(): void {
    this.stopHeartbeatLoop();
    this.client?.stop();
  }
}
