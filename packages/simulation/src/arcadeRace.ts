import { TICK_RATE, TRACK_LENGTH_METERS } from "./constants";

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

const MAX_SPEED = 82;
const BOOST_SPEED = 92;
const ACCELERATION = 24;
const BOOST_ACCELERATION = 8;
const BRAKING = 34;
const DRAG = 0.34;
const STEERING_SPEED = 5.2;
const ROAD_HALF_WIDTH = 3.25;

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
    -ROAD_HALF_WIDTH,
    ROAD_HALF_WIDTH,
  );
  player.lean += (input.steering - player.lean) * Math.min(1, deltaSeconds * 8);
  player.distance = Math.min(
    ARCADE_RACE_DISTANCE_METERS,
    player.distance + player.speed * deltaSeconds,
  );
}

export const advanceArcadePlayer = advancePlayer;

export function createRoomCode(randomInt: (exclusiveMax: number) => number): string {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    const character = ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    if (!character) throw new Error("Room code alphabet index out of range");
    code += character;
  }
  return code;
}
