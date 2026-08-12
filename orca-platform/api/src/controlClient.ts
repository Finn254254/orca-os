import type { ClusterConfig, CommandRecord, CommandType, NodeGroup, NodeMetrics, NodeRecord } from "@orca/shared";

export class ControlClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Thin client for Orca Control's internal REST API. Trusted-internal-network
 * by default; if `serviceToken` is provided it's sent as a Bearer token —
 * set it (and Control's matching ORCA_CONTROL_SERVICE_TOKEN) to require
 * service-to-service auth on that boundary. See docs/SECURITY.md.
 */
export class ControlClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken?: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(this.serviceToken ? { authorization: `Bearer ${this.serviceToken}` } : {}),
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ControlClientError(`orca-control ${path} -> ${res.status}: ${body}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  health(): Promise<{ status: string }> {
    return this.request("/api/v1/health");
  }

  listNodes(): Promise<(NodeRecord & { connected: boolean })[]> {
    return this.request("/api/v1/nodes");
  }

  getNode(id: string): Promise<(NodeRecord & { connected: boolean }) | undefined> {
    return this.request<NodeRecord & { connected: boolean }>(`/api/v1/nodes/${encodeURIComponent(id)}`).catch((err) => {
      if (err instanceof ControlClientError && err.status === 404) return undefined;
      throw err;
    });
  }

  getNodeMetrics(id: string): Promise<NodeMetrics | null> {
    return this.request(`/api/v1/nodes/${encodeURIComponent(id)}/metrics`);
  }

  createCommand(nodeId: string, type: CommandType, payload: Record<string, unknown>): Promise<CommandRecord> {
    return this.request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/commands`, {
      method: "POST",
      body: JSON.stringify({ type, payload }),
    });
  }

  listCommands(nodeId?: string): Promise<CommandRecord[]> {
    return this.request(`/api/v1/commands${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ""}`);
  }

  getCommand(id: string): Promise<CommandRecord> {
    return this.request(`/api/v1/commands/${encodeURIComponent(id)}`);
  }

  getClusterConfig(): Promise<ClusterConfig> {
    return this.request("/api/v1/cluster/config");
  }

  updateClusterConfig(patch: Partial<ClusterConfig>): Promise<ClusterConfig> {
    return this.request("/api/v1/cluster/config", { method: "PUT", body: JSON.stringify(patch) });
  }

  listGroups(): Promise<NodeGroup[]> {
    return this.request("/api/v1/cluster/groups");
  }

  createGroup(group: NodeGroup): Promise<NodeGroup[]> {
    return this.request("/api/v1/cluster/groups", { method: "POST", body: JSON.stringify(group) });
  }
}
