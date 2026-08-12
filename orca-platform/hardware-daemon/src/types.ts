export interface TemperatureReading {
  sensor: string;
  celsius: number;
}

export interface FanState {
  id: string;
  rpm: number;
  targetPct: number;
}

export interface PowerState {
  state: "on" | "standby" | "off";
  voltage: number;
  currentAmps: number;
  wattage: number;
}

export interface LedState {
  id: string;
  color: string;
  on: boolean;
}

export interface ButtonEvent {
  id: string;
  pressedAt: string;
}

export interface WatchdogState {
  armed: boolean;
  timeoutMs?: number;
  lastPetAt?: string;
  expired: boolean;
}

/**
 * The interface the rest of the platform depends on. Because physical Orca
 * hardware doesn't exist yet, the only implementation today is
 * `SimulatedHardwareBackend` — a real MCU/board-management backend can
 * implement this same interface later without changing any consumer. See
 * orca-platform/docs/OS_INTEGRATION.md for what that would need from the
 * OS/hardware layer.
 */
export interface HardwareBackend {
  getTemperatures(): Promise<TemperatureReading[]>;
  getFans(): Promise<FanState[]>;
  setFanSpeed(fanId: string, targetPct: number): Promise<FanState>;
  getPower(): Promise<PowerState>;
  setPowerState(state: PowerState["state"]): Promise<PowerState>;
  getLeds(): Promise<LedState[]>;
  setLed(id: string, on: boolean): Promise<LedState>;
  getRecentButtonEvents(): Promise<ButtonEvent[]>;
  getWatchdog(): Promise<WatchdogState>;
  armWatchdog(timeoutMs: number): Promise<WatchdogState>;
  disarmWatchdog(): Promise<WatchdogState>;
  petWatchdog(): Promise<WatchdogState>;
}
