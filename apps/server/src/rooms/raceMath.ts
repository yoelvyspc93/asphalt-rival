import type { PlayerInputMessage } from "@game-moto/protocol";
import { RACE_DISTANCE_METERS, type PlayerState } from "@game-moto/protocol";

const MAX_SPEED = 82;
const BOOST_SPEED = 92;
const ACCELERATION = 24;
const BOOST_ACCELERATION = 8;
const BRAKING = 34;
const DRAG = 0.34;
const STEERING_SPEED = 5.2;
const ROAD_HALF_WIDTH = 3.25;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function advancePlayer(
  player: PlayerState,
  input: PlayerInputMessage,
  deltaSeconds: number,
): void {
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
    RACE_DISTANCE_METERS,
    player.distance + player.speed * deltaSeconds,
  );
}

export function idleInput(tick: number): PlayerInputMessage {
  return { tick, throttle: 0, brake: 0, steering: 0, boost: false };
}

