import { PROTOCOL_VERSION } from "@game-moto/protocol";

export interface HealthPayload {
  status: "ok";
  service: "game-moto-server";
  protocolVersion: number;
  uptimeSeconds: number;
  timestamp: string;
}

export function createHealthPayload(now = new Date(), uptime = process.uptime()): HealthPayload {
  return {
    status: "ok",
    service: "game-moto-server",
    protocolVersion: PROTOCOL_VERSION,
    uptimeSeconds: Math.floor(uptime),
    timestamp: now.toISOString(),
  };
}

