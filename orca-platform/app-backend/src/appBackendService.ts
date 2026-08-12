import type { ClusterConfig, DevicePlatform, NodeRecord, NotificationKind, NotificationRecord } from "@orca/shared";
import { DeviceStore } from "./deviceStore.js";
import { NotificationStore } from "./notificationStore.js";

/** Narrow structural port onto cluster state — same pattern as ControlPort in @orca/compute/@orca/deploy/@orca/update. */
export interface ClusterPort {
  getClusterConfig(): Promise<ClusterConfig>;
  listNodes(): Promise<(NodeRecord & { connected: boolean })[]>;
}

/** Narrow structural port for broadcast targets — avoids depending on @orca/security's full UserStore surface. */
export interface UserDirectory {
  listUserIds(): string[];
}

export interface DiscoveryInfo {
  service: "orca-api";
  clusterName: string;
  apiVersion: "v1";
  serverTime: string;
}

export interface ClusterSummary {
  clusterName: string;
  nodeCount: number;
  onlineCount: number;
  offlineCount: number;
  avgCpuUtilizationPct: number | null;
  avgRamUsedPct: number | null;
}

export interface AppBackendServiceOptions {
  cluster: ClusterPort;
  users: UserDirectory;
  notifications: NotificationStore;
  devices: DeviceStore;
}

/**
 * Backend support for future mobile/desktop Orca clients: a lightweight
 * unauthenticated "is this an Orca server" discovery endpoint, a
 * mobile-optimized cluster status rollup (one request instead of several),
 * and a notification inbox + device registry. Every other capability a
 * mobile/desktop app needs — auth, AI conversations, nodes/apps/models/jobs
 * — is the existing Orca API surface; this service exists only for the
 * genuinely mobile-specific pieces, not a duplicate of what's already
 * there. See app-backend/README.md.
 */
export class AppBackendService {
  constructor(private readonly options: AppBackendServiceOptions) {}

  async discover(): Promise<DiscoveryInfo> {
    const config = await this.options.cluster.getClusterConfig();
    return { service: "orca-api", clusterName: config.clusterName, apiVersion: "v1", serverTime: new Date().toISOString() };
  }

  async summary(): Promise<ClusterSummary> {
    const [config, nodes] = await Promise.all([this.options.cluster.getClusterConfig(), this.options.cluster.listNodes()]);
    const online = nodes.filter((n) => n.status === "online");
    const cpuSamples = nodes.map((n) => n.lastMetrics?.cpuUtilizationPct).filter((v): v is number => typeof v === "number");
    const ramSamples = nodes
      .map((n) => {
        const used = n.lastMetrics?.ramUsedBytes;
        const total = n.lastMetrics?.ramTotalBytes;
        return typeof used === "number" && typeof total === "number" && total > 0 ? (used / total) * 100 : undefined;
      })
      .filter((v): v is number => typeof v === "number");
    const avg = (samples: number[]) => (samples.length === 0 ? null : samples.reduce((a, b) => a + b, 0) / samples.length);

    return {
      clusterName: config.clusterName,
      nodeCount: nodes.length,
      onlineCount: online.length,
      offlineCount: nodes.length - online.length,
      avgCpuUtilizationPct: avg(cpuSamples),
      avgRamUsedPct: avg(ramSamples),
    };
  }

  // ---- Notifications ----

  listNotifications(userId: string, unreadOnly = false): NotificationRecord[] {
    return this.options.notifications.listForUser(userId, unreadOnly);
  }

  async markNotificationRead(userId: string, id: string): Promise<NotificationRecord | undefined> {
    const notification = this.options.notifications.get(id);
    if (!notification || notification.userId !== userId) return undefined;
    return this.options.notifications.markRead(id);
  }

  markAllNotificationsRead(userId: string): Promise<number> {
    return this.options.notifications.markAllRead(userId);
  }

  /** Sends a notification to one user, or to every known user if `userId` is omitted (a broadcast — e.g. "maintenance at 10pm"). */
  async sendNotification(input: { userId?: string; kind: NotificationKind; title: string; message: string; data?: Record<string, unknown> }): Promise<NotificationRecord[]> {
    const targets = input.userId ? [input.userId] : this.options.users.listUserIds();
    return Promise.all(targets.map((userId) => this.options.notifications.create({ ...input, userId })));
  }

  // ---- Devices ----

  listDevices(userId: string) {
    return this.options.devices.listForUser(userId);
  }

  registerDevice(userId: string, platform: DevicePlatform, pushToken: string, label?: string) {
    return this.options.devices.register(userId, platform, pushToken, label);
  }

  async unregisterDevice(userId: string, id: string): Promise<boolean> {
    const device = this.options.devices.get(id);
    if (!device || device.userId !== userId) return false;
    return this.options.devices.unregister(id);
  }
}
