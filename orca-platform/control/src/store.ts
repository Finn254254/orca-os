import { join } from "node:path";
import {
  ClusterConfigSchema,
  JsonStore,
  generateId,
  now,
  type ClusterConfig,
  type CommandRecord,
  type CommandStatus,
  type CommandType,
  type NodeCapabilities,
  type NodeGroup,
  type NodeMetrics,
  type NodeRecord,
  type NodeStatus,
  type ServiceStatus,
} from "@orca/shared";

export interface ClusterState {
  config: ClusterConfig;
  nodes: Record<string, NodeRecord>;
  commands: Record<string, CommandRecord>;
}

const DEFAULT_STATE: ClusterState = {
  config: ClusterConfigSchema.parse({}),
  nodes: {},
  commands: {},
};

/**
 * Orca Control's authoritative view of cluster state: node identity/registry,
 * groups, health, hardware capabilities, service status, commands, and
 * persistent cluster configuration. Backed by a durable JSON store so
 * Control can restart without losing node identity or configuration.
 */
export class ClusterStore {
  private readonly jsonStore: JsonStore<ClusterState>;

  constructor(dataDir: string, clusterName?: string) {
    this.jsonStore = new JsonStore(join(dataDir, "cluster-state.json"), {
      ...DEFAULT_STATE,
      config: { ...DEFAULT_STATE.config, clusterName: clusterName ?? DEFAULT_STATE.config.clusterName },
    });
  }

  async init(): Promise<void> {
    await this.jsonStore.load();
  }

  /** Waits for every write enqueued so far to be durably persisted. Call before process shutdown. */
  async flush(): Promise<void> {
    await this.jsonStore.flush();
  }

  getClusterConfig(): ClusterConfig {
    return this.jsonStore.get().config;
  }

  async updateClusterConfig(patch: Partial<ClusterConfig>): Promise<ClusterConfig> {
    const state = await this.jsonStore.mutate((s) => ({
      ...s,
      config: ClusterConfigSchema.parse({ ...s.config, ...patch }),
    }));
    return state.config;
  }

  async addGroup(group: NodeGroup): Promise<ClusterConfig> {
    const state = await this.jsonStore.mutate((s) => {
      if (s.config.groups.some((g) => g.name === group.name)) return s;
      return { ...s, config: { ...s.config, groups: [...s.config.groups, group] } };
    });
    return state.config;
  }

  listNodes(): NodeRecord[] {
    return Object.values(this.jsonStore.get().nodes).sort((a, b) => a.name.localeCompare(b.name));
  }

  getNode(nodeId: string): NodeRecord | undefined {
    return this.jsonStore.get().nodes[nodeId];
  }

  async registerNode(input: {
    nodeId: string;
    name: string;
    group?: string;
    address?: string;
    capabilities?: NodeCapabilities;
  }): Promise<NodeRecord> {
    const state = await this.jsonStore.mutate((s) => {
      const existing = s.nodes[input.nodeId];
      const record: NodeRecord = {
        id: input.nodeId,
        name: input.name,
        group: input.group ?? existing?.group ?? "default",
        address: input.address ?? existing?.address,
        status: "online",
        capabilities: input.capabilities ?? existing?.capabilities,
        lastMetrics: existing?.lastMetrics,
        services: existing?.services ?? [],
        registeredAt: existing?.registeredAt ?? now(),
        lastHeartbeatAt: now(),
        labels: existing?.labels ?? {},
      };
      const groups = s.config.groups.some((g) => g.name === record.group)
        ? s.config.groups
        : [...s.config.groups, { name: record.group }];
      return { ...s, nodes: { ...s.nodes, [record.id]: record }, config: { ...s.config, groups } };
    });
    return state.nodes[input.nodeId];
  }

  async recordHeartbeat(nodeId: string, metrics?: NodeMetrics, services?: ServiceStatus[]): Promise<NodeRecord | undefined> {
    const state = await this.jsonStore.mutate((s) => {
      const existing = s.nodes[nodeId];
      if (!existing) return s;
      const updated: NodeRecord = {
        ...existing,
        status: "online",
        lastHeartbeatAt: now(),
        lastMetrics: metrics ?? existing.lastMetrics,
        services: services ?? existing.services,
      };
      return { ...s, nodes: { ...s.nodes, [nodeId]: updated } };
    });
    return state.nodes[nodeId];
  }

  async setNodeStatus(nodeId: string, status: NodeStatus): Promise<NodeRecord | undefined> {
    const state = await this.jsonStore.mutate((s) => {
      const existing = s.nodes[nodeId];
      if (!existing || existing.status === status) return s;
      return { ...s, nodes: { ...s.nodes, [nodeId]: { ...existing, status } } };
    });
    return state.nodes[nodeId];
  }

  /** Marks any node whose heartbeat is older than the cluster timeout as offline. Returns newly-offline node ids. */
  async sweepStaleNodes(): Promise<string[]> {
    const timeoutMs = this.getClusterConfig().heartbeatTimeoutMs;
    const nowMs = Date.now();
    const wentOffline: string[] = [];
    await this.jsonStore.mutate((s) => {
      const nodes = { ...s.nodes };
      for (const node of Object.values(nodes)) {
        if (node.status === "online" && node.lastHeartbeatAt) {
          const age = nowMs - new Date(node.lastHeartbeatAt).getTime();
          if (age > timeoutMs) {
            nodes[node.id] = { ...node, status: "offline" };
            wentOffline.push(node.id);
          }
        }
      }
      return { ...s, nodes };
    });
    return wentOffline;
  }

  async createCommand(nodeId: string, type: CommandType, payload: Record<string, unknown>): Promise<CommandRecord> {
    const command: CommandRecord = {
      id: generateId("cmd"),
      nodeId,
      type,
      payload,
      status: "pending",
      createdAt: now(),
    };
    await this.jsonStore.mutate((s) => ({ ...s, commands: { ...s.commands, [command.id]: command } }));
    return command;
  }

  async markCommandStatus(commandId: string, status: CommandStatus): Promise<CommandRecord | undefined> {
    const state = await this.jsonStore.mutate((s) => {
      const cmd = s.commands[commandId];
      if (!cmd) return s;
      return { ...s, commands: { ...s.commands, [commandId]: { ...cmd, status } } };
    });
    return state.commands[commandId];
  }

  async completeCommand(
    commandId: string,
    status: CommandStatus,
    result?: Record<string, unknown>,
    error?: string,
  ): Promise<CommandRecord | undefined> {
    const state = await this.jsonStore.mutate((s) => {
      const cmd = s.commands[commandId];
      if (!cmd) return s;
      return { ...s, commands: { ...s.commands, [commandId]: { ...cmd, status, result, error, completedAt: now() } } };
    });
    return state.commands[commandId];
  }

  getCommand(commandId: string): CommandRecord | undefined {
    return this.jsonStore.get().commands[commandId];
  }

  listCommands(nodeId?: string): CommandRecord[] {
    const commands = Object.values(this.jsonStore.get().commands);
    const filtered = nodeId ? commands.filter((c) => c.nodeId === nodeId) : commands;
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
