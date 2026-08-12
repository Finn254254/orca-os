import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { SimulatedHardwareBackend } from "./simulatedBackend.js";
import { createHardwareDaemon, type HardwareDaemonHandle } from "./server.js";

describe("hardware daemon HTTP API", () => {
  let handle: HardwareDaemonHandle;
  let baseUrl: string;
  let backend: SimulatedHardwareBackend;

  beforeEach(async () => {
    backend = new SimulatedHardwareBackend();
    handle = await createHardwareDaemon(0, backend);
    const address = handle.httpServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await handle.close();
  });

  it("reports health and temperatures", async () => {
    expect((await request(baseUrl).get("/api/v1/health")).status).toBe(200);
    const temps = await request(baseUrl).get("/api/v1/temperatures");
    expect(temps.status).toBe(200);
    expect(temps.body.some((t: { sensor: string }) => t.sensor === "cpu")).toBe(true);
  });

  it("sets and reads fan speed", async () => {
    const set = await request(baseUrl).post("/api/v1/fans/fan1").send({ targetPct: 80 });
    expect(set.status).toBe(200);
    expect(set.body.targetPct).toBe(80);
    expect((await request(baseUrl).get("/api/v1/fans")).body.find((f: { id: string }) => f.id === "fan1").targetPct).toBe(80);
  });

  it("404s setting an unknown fan and 400s on a missing targetPct", async () => {
    expect((await request(baseUrl).post("/api/v1/fans/nope").send({ targetPct: 10 })).status).toBe(404);
    expect((await request(baseUrl).post("/api/v1/fans/fan1").send({})).status).toBe(400);
  });

  it("gets and sets power state", async () => {
    const set = await request(baseUrl).post("/api/v1/power").send({ state: "standby" });
    expect(set.body.state).toBe("standby");
    expect((await request(baseUrl).get("/api/v1/power")).body.state).toBe("standby");
  });

  it("rejects an invalid power state", async () => {
    expect((await request(baseUrl).post("/api/v1/power").send({ state: "explode" })).status).toBe(400);
  });

  it("toggles LEDs", async () => {
    const set = await request(baseUrl).post("/api/v1/leds/status").send({ on: false });
    expect(set.body.on).toBe(false);
  });

  it("arms, pets, and disarms the watchdog", async () => {
    const armed = await request(baseUrl).post("/api/v1/watchdog/arm").send({ timeoutMs: 5000 });
    expect(armed.body.armed).toBe(true);
    const petted = await request(baseUrl).post("/api/v1/watchdog/pet");
    expect(petted.body.armed).toBe(true);
    const disarmed = await request(baseUrl).post("/api/v1/watchdog/disarm");
    expect(disarmed.body.armed).toBe(false);
  });

  it("lists button events after a simulated press", async () => {
    backend.simulateButtonPress("power-button");
    const res = await request(baseUrl).get("/api/v1/buttons");
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("power-button");
  });
});
