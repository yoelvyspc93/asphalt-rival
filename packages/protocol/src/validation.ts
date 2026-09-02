import type {
  PingMessage,
  PlayerInputMessage,
  PlayerReadyMessage,
  RaceRoomOptions,
} from "./messages";

const DEFAULT_NAME = "Piloto";
const MAX_NAME_LENGTH = 20;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function sanitizeDisplayName(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_NAME;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME_LENGTH);
  return clean || DEFAULT_NAME;
}

export function sanitizeBikeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

export function parseRaceRoomOptions(value: unknown): RaceRoomOptions {
  if (!isRecord(value)) return {};
  const options: RaceRoomOptions = {};
  if (typeof value.displayName === "string") options.displayName = value.displayName;
  if (typeof value.bikeColor === "string") options.bikeColor = value.bikeColor;
  if (finiteNumber(value.protocolVersion)) options.protocolVersion = value.protocolVersion;
  return options;
}

export function parsePlayerInput(value: unknown): PlayerInputMessage | null {
  if (!isRecord(value) || !finiteNumber(value.tick)) return null;
  if (!finiteNumber(value.throttle) || !finiteNumber(value.brake)) return null;
  if (!finiteNumber(value.steering) || typeof value.boost !== "boolean") return null;

  return {
    tick: Math.max(0, Math.trunc(value.tick)),
    throttle: clamp(value.throttle, 0, 1),
    brake: clamp(value.brake, 0, 1),
    steering: clamp(value.steering, -1, 1),
    boost: value.boost,
  };
}

export function parsePlayerReady(value: unknown): PlayerReadyMessage | null {
  return isRecord(value) && typeof value.ready === "boolean" ? { ready: value.ready } : null;
}

export function parsePing(value: unknown): PingMessage | null {
  return isRecord(value) && finiteNumber(value.clientTime)
    ? { clientTime: value.clientTime }
    : null;
}

