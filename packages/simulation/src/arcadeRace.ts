import { BIKE_LENGTH_METERS, BIKE_WIDTH_METERS, TICK_RATE, TRACK_LENGTH_METERS } from "./constants";
import type { TrafficVehicleState } from "./types";

/** Same alphabet as the local Colyseus room ids (no I, O, 0, 1). */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ARCADE_TICK_RATE = TICK_RATE;
export const ARCADE_COUNTDOWN_MS = 3_000;
export const ARCADE_TICK_MS = 1_000 / TICK_RATE;
export const ARCADE_GUEST_INPUT_HZ = 10;
export const ARCADE_GUEST_INPUT_INTERVAL_MS = 1_000 / ARCADE_GUEST_INPUT_HZ;
export const ARCADE_SNAPSHOT_INTERVAL_MS = 180;
export const ARCADE_RACE_DISTANCE_METERS = TRACK_LENGTH_METERS;
export const ARCADE_PLAYER_STARTS = [-1.55, 1.55] as const;
export const ARCADE_LANE_CENTERS = [-4.65, -1.55, 1.55, 4.65] as const;
export const ARCADE_ROAD_HALF_WIDTH = 5.55;
export const ARCADE_TRAFFIC_HIT_COOLDOWN_MS = 900;
export const ARCADE_TRAFFIC_HITSTUN_MS = 850;

const MAX_SPEED = 82;
const BOOST_SPEED = 92;
const ACCELERATION = 24;
const BOOST_ACCELERATION = 8;
const BRAKING = 34;
const DRAG = 0.34;
const STEERING_SPEED = 5.2;
const TRAFFIC_HIT_SPEED_CAP = 8;
const LATERAL_FORGIVENESS = 0.55;
const LONGITUDINAL_FORGIVENESS = 5.6;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export type ArcadePhase = "waiting" | "countdown" | "racing" | "finished";

export type ArcadeInput = {
  tick: number;
  throttle: number;
  brake: number;
  steering: number;
  boost: boolean;
};

export type ArcadeBody = {
  speed: number;
  lateralPosition: number;
  lean: number;
  distance: number;
  hitstunMs?: number;
};

export type ArcadePlayerState = ArcadeBody;

export function idleInput(tick: number): ArcadeInput {
  return { tick, throttle: 0, brake: 0, steering: 0, boost: false };
}

export const idleArcadeInput = idleInput;

export function raceInputFromControls(
  tick: number,
  throttle: number,
  brake: number,
  steering: number,
): ArcadeInput {
  return { tick, throttle, brake, steering, boost: false };
}

export function advancePlayer(player: ArcadeBody, input: ArcadeInput, deltaSeconds: number): void {
  const maxSpeed = input.boost ? BOOST_SPEED : MAX_SPEED;
  const drive = input.throttle * ACCELERATION + (input.boost ? BOOST_ACCELERATION : 0);
  const resistance = input.brake * BRAKING + player.speed * DRAG;

  player.speed = clamp(player.speed + (drive - resistance) * deltaSeconds, 0, maxSpeed);
  player.lateralPosition = clamp(
    player.lateralPosition + input.steering * STEERING_SPEED * deltaSeconds,
    -ARCADE_ROAD_HALF_WIDTH,
    ARCADE_ROAD_HALF_WIDTH,
  );
  player.lean += (input.steering - player.lean) * Math.min(1, deltaSeconds * 8);
  player.distance = Math.min(
    ARCADE_RACE_DISTANCE_METERS,
    player.distance + player.speed * deltaSeconds,
  );
}

export const advanceArcadePlayer = advancePlayer;

export type ArcadeTrafficHit = {
  trafficId: string;
};

export function arcadeLaneCenter(laneIndex: number) {
  return ARCADE_LANE_CENTERS[laneIndex] ?? 0;
}

function trafficCarDistance(car: TrafficVehicleState, elapsedSeconds: number) {
  return car.distance + car.speed * elapsedSeconds;
}

export function arcadeTrafficOverlaps(
  player: Pick<ArcadeBody, "distance" | "lateralPosition">,
  car: TrafficVehicleState,
  elapsedSeconds: number,
) {
  const carDistance = trafficCarDistance(car, elapsedSeconds);
  const laneX = arcadeLaneCenter(car.laneIndex);
  const halfWidth = BIKE_WIDTH_METERS / 2 + car.width / 2 + LATERAL_FORGIVENESS;
  const halfLength = BIKE_LENGTH_METERS / 2 + car.length / 2 + LONGITUDINAL_FORGIVENESS;
  return (
    Math.abs(player.lateralPosition - laneX) < halfWidth &&
    Math.abs(player.distance - carDistance) < halfLength
  );
}

/** Blocks the bike behind traffic and dumps speed while overlapping. */
export function applyArcadeTrafficCollisions(
  player: ArcadeBody,
  traffic: readonly TrafficVehicleState[],
  elapsedSeconds: number,
  cooldownUntilMs: Map<string, number>,
  nowMs: number,
  playerId: string,
): ArcadeTrafficHit | null {
  let hit: ArcadeTrafficHit | null = null;

  for (const car of traffic) {
    if (!arcadeTrafficOverlaps(player, car, elapsedSeconds)) continue;

    const carDistance = trafficCarDistance(car, elapsedSeconds);
    const rearLimit = carDistance - car.length / 2 - BIKE_LENGTH_METERS / 2;
    if (player.distance > rearLimit) player.distance = rearLimit;
    player.speed = Math.min(
      player.speed,
      Math.max(3.2, Math.min(car.speed * 0.28, TRAFFIC_HIT_SPEED_CAP)),
    );

    const laneX = arcadeLaneCenter(car.laneIndex);
    const push = player.lateralPosition <= laneX ? -1 : 1;
    player.lateralPosition = clamp(
      player.lateralPosition + push * 0.28,
      -ARCADE_ROAD_HALF_WIDTH,
      ARCADE_ROAD_HALF_WIDTH,
    );

    const cooldownKey = `${playerId}:${car.id}`;
    if (nowMs < (cooldownUntilMs.get(cooldownKey) ?? 0)) continue;

    cooldownUntilMs.set(cooldownKey, nowMs + ARCADE_TRAFFIC_HIT_COOLDOWN_MS);
    player.hitstunMs = Math.max(player.hitstunMs ?? 0, ARCADE_TRAFFIC_HITSTUN_MS);
    hit ??= { trafficId: car.id };
  }

  return hit;
}

export function createRoomCode(randomInt: (exclusiveMax: number) => number): string {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    const character = ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    if (!character) throw new Error("Room code alphabet index out of range");
    code += character;
  }
  return code;
}
