import type { ButtonEvent, FanState, HardwareBackend, LedState, PowerState, TemperatureReading, WatchdogState } from "./types.js";

function jitter(base: number, spread: number): number {
  return base + (Math.random() - 0.5) * 2 * spread;
}

/**
 * Simulated hardware so the rest of the platform (Agent, Dashboard, CLI)
 * can be built and tested before physical Orca electronics exist. State
 * evolves plausibly (fans converge toward their target RPM, temperature
 * responds to fan speed) rather than returning static numbers.
 */
export class SimulatedHardwareBackend implements HardwareBackend {
  private fans: Record<string, FanState> = {
    fan1: { id: "fan1", rpm: 1500, targetPct: 50 },
    fan2: { id: "fan2", rpm: 1500, targetPct: 50 },
  };
  private leds: Record<string, LedState> = {
    power: { id: "power", color: "green", on: true },
    status: { id: "status", color: "blue", on: true },
  };
  private powerState: PowerState["state"] = "on";
  private buttonEvents: ButtonEvent[] = [];
  private watchdog: { armed: boolean; timeoutMs?: number; lastPetAt?: number } = { armed: false };

  async getTemperatures(): Promise<TemperatureReading[]> {
    const avgFanPct = (this.fans.fan1.targetPct + this.fans.fan2.targetPct) / 2;
    // More airflow -> lower steady-state temperature; a light random walk on top.
    const baseline = 70 - avgFanPct * 0.35;
    return [
      { sensor: "cpu", celsius: Math.round(jitter(baseline, 3) * 10) / 10 },
      { sensor: "board", celsius: Math.round(jitter(baseline - 8, 2) * 10) / 10 },
    ];
  }

  async getFans(): Promise<FanState[]> {
    return Object.values(this.fans).map((fan) => {
      const targetRpm = (fan.targetPct / 100) * 3000;
      // RPM drifts toward its target rather than snapping instantly.
      const rpm = Math.round(fan.rpm + (targetRpm - fan.rpm) * 0.5 + jitter(0, 20));
      this.fans[fan.id] = { ...fan, rpm };
      return this.fans[fan.id];
    });
  }

  async setFanSpeed(fanId: string, targetPct: number): Promise<FanState> {
    const fan = this.fans[fanId];
    if (!fan) throw new Error(`unknown fan "${fanId}"`);
    const clamped = Math.max(0, Math.min(100, targetPct));
    this.fans[fanId] = { ...fan, targetPct: clamped };
    return this.fans[fanId];
  }

  async getPower(): Promise<PowerState> {
    const loadFactor = this.powerState === "on" ? (this.fans.fan1.targetPct + this.fans.fan2.targetPct) / 200 : 0;
    const voltage = this.powerState === "off" ? 0 : Math.round(jitter(12, 0.1) * 100) / 100;
    const currentAmps = this.powerState === "on" ? Math.round(jitter(2 + loadFactor * 3, 0.2) * 100) / 100 : 0;
    return { state: this.powerState, voltage, currentAmps, wattage: Math.round(voltage * currentAmps * 10) / 10 };
  }

  async setPowerState(state: PowerState["state"]): Promise<PowerState> {
    this.powerState = state;
    return this.getPower();
  }

  async getLeds(): Promise<LedState[]> {
    return Object.values(this.leds);
  }

  async setLed(id: string, on: boolean): Promise<LedState> {
    const led = this.leds[id];
    if (!led) throw new Error(`unknown LED "${id}"`);
    this.leds[id] = { ...led, on };
    return this.leds[id];
  }

  async getRecentButtonEvents(): Promise<ButtonEvent[]> {
    return [...this.buttonEvents];
  }

  /** Test/demo hook — there's no physical button to press yet. */
  simulateButtonPress(id: string): ButtonEvent {
    const event: ButtonEvent = { id, pressedAt: new Date().toISOString() };
    this.buttonEvents = [...this.buttonEvents.slice(-19), event];
    return event;
  }

  async getWatchdog(): Promise<WatchdogState> {
    const { armed, timeoutMs, lastPetAt } = this.watchdog;
    const expired = armed && timeoutMs !== undefined && lastPetAt !== undefined && Date.now() - lastPetAt > timeoutMs;
    return {
      armed,
      timeoutMs,
      lastPetAt: lastPetAt !== undefined ? new Date(lastPetAt).toISOString() : undefined,
      expired,
    };
  }

  async armWatchdog(timeoutMs: number): Promise<WatchdogState> {
    this.watchdog = { armed: true, timeoutMs, lastPetAt: Date.now() };
    return this.getWatchdog();
  }

  async disarmWatchdog(): Promise<WatchdogState> {
    this.watchdog = { armed: false };
    return this.getWatchdog();
  }

  async petWatchdog(): Promise<WatchdogState> {
    if (this.watchdog.armed) this.watchdog = { ...this.watchdog, lastPetAt: Date.now() };
    return this.getWatchdog();
  }
}
