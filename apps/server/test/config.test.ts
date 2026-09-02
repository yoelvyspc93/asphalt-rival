import { describe, expect, it } from "vitest";
import { getServerConfig } from "../src/config";
import { createHealthPayload } from "../src/health";

describe("server configuration", () => {
  it("uses safe defaults and validates the port", () => {
    expect(getServerConfig({})).toEqual({ host: "0.0.0.0", port: 2567, allowedOrigin: "*" });
    expect(getServerConfig({ PORT: "70000" }).port).toBe(2567);
    expect(getServerConfig({ PORT: "3000", HOST: "127.0.0.1" }).port).toBe(3000);
  });

  it("returns a stable health contract", () => {
    expect(createHealthPayload(new Date("2026-09-01T12:00:00.000Z"), 42.8)).toMatchObject({
      status: "ok",
      service: "game-moto-server",
      uptimeSeconds: 42,
      timestamp: "2026-09-01T12:00:00.000Z",
    });
  });
});
