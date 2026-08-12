import { join } from "node:path";
import { JsonStore, generateId, now, type NotificationKind, type NotificationRecord } from "@orca/shared";

interface NotificationsState {
  notifications: Record<string, NotificationRecord>;
}

export interface CreateNotificationInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

/** Per-user notification inbox. */
export class NotificationStore {
  private readonly store: JsonStore<NotificationsState>;

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "notifications.json"), { notifications: {} });
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  async create(input: CreateNotificationInput): Promise<NotificationRecord> {
    const notification: NotificationRecord = {
      id: generateId("notif"),
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      message: input.message,
      data: input.data ?? {},
      createdAt: now(),
    };
    await this.store.mutate((s) => ({ notifications: { ...s.notifications, [notification.id]: notification } }));
    return notification;
  }

  listForUser(userId: string, unreadOnly = false): NotificationRecord[] {
    return Object.values(this.store.get().notifications)
      .filter((n) => n.userId === userId && (!unreadOnly || !n.readAt))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): NotificationRecord | undefined {
    return this.store.get().notifications[id];
  }

  async markRead(id: string): Promise<NotificationRecord | undefined> {
    const state = await this.store.mutate((s) => {
      const notification = s.notifications[id];
      if (!notification || notification.readAt) return s;
      return { notifications: { ...s.notifications, [id]: { ...notification, readAt: now() } } };
    });
    return state.notifications[id];
  }

  async markAllRead(userId: string): Promise<number> {
    let count = 0;
    await this.store.mutate((s) => {
      const updated = { ...s.notifications };
      for (const [id, notification] of Object.entries(s.notifications)) {
        if (notification.userId === userId && !notification.readAt) {
          updated[id] = { ...notification, readAt: now() };
          count++;
        }
      }
      return { notifications: updated };
    });
    return count;
  }
}
