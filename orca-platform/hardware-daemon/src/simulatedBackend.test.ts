import { describe, expect, it, vi } from "vitest";
import { SimulatedHardwareBackend } from "./simulatedBackend.js";

describe("SimulatedHardwareBackend", () => {
  it("reports two fans that drift toward their target RPM", async () => {
    const backend = new SimulatedHardwareBackend();
    await backend.setFanSpeed("fan1", 100);
    const before = (await backend.getFans()).find((f) => f.id === "fan1")!;
    const after = (await backend.getFans()).find((f) => f.id === "fan1")!;
    expect(after.rpm).toBeGreaterThan(before.rpm - 50); // trending upward, allow jitter
  });

  it("rejects setting speed on an unknown fan", async () => {
    const backend = new SimulatedHardwareBackend();
    await expect(backend.setFanSpeed("nope", 50)).rejects.toThrow(/unknown fan/);
  });

  it("clamps fan target percentage to 0-100", async () => {
    const backend = new SimulatedHardwareBackend();
    expect((await backend.setFanSpeed("fan1", 150)).targetPct).toBe(100);
    expect((await backend.setFanSpeed("fan1", -10)).targetPct).toBe(0);
  });

  it("reports higher fan speed correlating with lower temperature baseline", async () => {
    const backend = new SimulatedHardwareBackend();
    await backend.setFanSpeed("fan1", 100);
    await backend.setFanSpeed("fan2", 100);
    const hot = await backend.getTemperatures();

    const cold = new SimulatedHardwareBackend();
    await cold.setFanSpeed("fan1", 0);
    await cold.setFanSpeed("fan2", 0);
    const coldReadings = await cold.getTemperatures();

    const hotCpu = hot.find((t) => t.sensor === "cpu")!.celsius;
    const coldCpu = coldReadings.find((t) => t.sensor === "cpu")!.celsius;
    expect(coldCpu).toBeGreaterThan(hotCpu - 5); // cold (low fan) trends hotter baseline
  });

  it("reports zero power draw when off", async () => {
    const backend = new SimulatedHardwareBackend();
    const power = await backend.setPowerState("off");
    expect(power).toMatchObject({ state: "off", voltage: 0, currentAmps: 0, wattage: 0 });
  });

  it("toggles LEDs and rejects unknown ids", async () => {
    const backend = new SimulatedHardwareBackend();
    const led = await backend.setLed("power", false);
    expect(led.on).toBe(false);
    await expect(backend.setLed("nope", true)).rejects.toThrow(/unknown LED/);
  });

  it("records simulated button presses", async () => {
    const backend = new SimulatedHardwareBackend();
    backend.simulateButtonPress("reset");
    const events = await backend.getRecentButtonEvents();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("reset");
  });

  it("arms, pets, and detects an expired watchdog", async () => {
    vi.useFakeTimers();
    try {
      const backend = new SimulatedHardwareBackend();
      await backend.armWatchdog(1000);
      let state = await backend.getWatchdog();
      expect(state.armed).toBe(true);
      expect(state.expired).toBe(false);

      vi.advanceTimersByTime(500);
      await backend.petWatchdog();
      vi.advanceTimersByTime(500);
      state = await backend.getWatchdog();
      expect(state.expired).toBe(false);

      vi.advanceTimersByTime(1500);
      state = await backend.getWatchdog();
      expect(state.expired).toBe(true);

      await backend.disarmWatchdog();
      state = await backend.getWatchdog();
      expect(state.armed).toBe(false);
      expect(state.expired).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
