import { join } from "node:path";
import { JsonStore, generateId, now, type DevicePlatform, type DeviceRegistration } from "@orca/shared";

interface DevicesState {
  devices: Record<string, DeviceRegistration>;
}

/**
 * Registry of mobile/desktop device push tokens. This is the piece a real
 * push relay (APNs/FCM/etc.) would read from to actually deliver
 * notifications — that delivery step isn't implemented, so registering a
 * device today just makes it visible via the API, nothing more. See
 * docs/PROGRESS.md's known limitations.
 */
export class DeviceStore {
  private readonly store: JsonStore<DevicesState>;

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "devices.json"), { devices: {} });
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  /** Registers a device, or refreshes `lastSeenAt` if this user already registered this exact push token. */
  async register(userId: string, platform: DevicePlatform, pushToken: string, label?: string): Promise<DeviceRegistration> {
    const existing = Object.values(this.store.get().devices).find((d) => d.userId === userId && d.pushToken === pushToken);
    if (existing) {
      const state = await this.store.mutate((s) => ({
        devices: { ...s.devices, [existing.id]: { ...existing, lastSeenAt: now(), label: label ?? existing.label } },
      }));
      return state.devices[existing.id];
    }
    const device: DeviceRegistration = {
      id: generateId("device"),
      userId,
      platform,
      pushToken,
      label,
      registeredAt: now(),
      lastSeenAt: now(),
    };
    await this.store.mutate((s) => ({ devices: { ...s.devices, [device.id]: device } }));
    return device;
  }

  listForUser(userId: string): DeviceRegistration[] {
    return Object.values(this.store.get().devices)
      .filter((d) => d.userId === userId)
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  get(id: string): DeviceRegistration | undefined {
    return this.store.get().devices[id];
  }

  async unregister(id: string): Promise<boolean> {
    if (!this.store.get().devices[id]) return false;
    await this.store.mutate((s) => {
      const { [id]: _removed, ...rest } = s.devices;
      return { devices: rest };
    });
    return true;
  }
}
