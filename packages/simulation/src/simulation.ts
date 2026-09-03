import {
  BIKE_LENGTH_METERS,
  BIKE_WIDTH_METERS,
  FIXED_TIME_STEP_SECONDS,
  HARD_COLLISION_SPEED_METERS_PER_SECOND,
  LANE_CENTERS_METERS,
  MAX_PLAYERS,
  MAX_SPEED_METERS_PER_SECOND,
  RESPAWN_IMMUNITY_TICKS,
  RESPAWN_TICKS,
  ROAD_HALF_WIDTH_METERS,
  TICK_RATE,
  TRACK_LENGTH_METERS,
} from "./constants";
import { normalizeSeed } from "./random";
import { generateTraffic } from "./traffic";
import type {
  FinishTime,
  InputsByPlayer,
  PlayerState,
  RaceRanking,
  RaceResult,
  RiderInput,
  RiderInputLike,
  SimulationEvent,
  SimulationState,
  SimulationStep,
  TrafficVehicleState,
} from "./types";

const ENGINE_ACCELERATION = 19;
const BRAKE_DECELERATION = 46;
const AERODYNAMIC_DRAG = 0.0022;
const ROLLING_RESISTANCE = 0.18;
const MAX_LATERAL_ACCELERATION = 18;
const SOFT_COLLISION_COOLDOWN_TICKS = 24;
const BIKE_ROAD_MARGIN = BIKE_WIDTH_METERS / 2;

export interface CreateSimulationOptions {
  trafficDensityPerLaneKm?: number;
}

export function normalizeInput(input: RiderInputLike): RiderInput {
  return {
    throttle: clampFinite(input?.throttle, 0, 1),
    brake: clampFinite(input?.brake, 0, 1),
    steer: clampFinite(input?.steer, -1, 1),
  };
}

export function createSimulationState(
  playerIds: readonly string[],
  seed: number,
  options: CreateSimulationOptions = {},
): SimulationState {
  validatePlayerIds(playerIds);

  const startOffsets = playerIds.length === 1 ? [0] : [-0.9, 0.9];
  const players = playerIds.map<PlayerState>((id, index) => ({
    id,
    lateralPosition: startOffsets[index]!,
    distance: 0,
    longitudinalSpeed: 0,
    lateralSpeed: 0,
    headingRadians: 0,
    status: "racing",
    respawnTicksRemaining: 0,
    immunityTicksRemaining: 0,
    finish: null,
  }));

  return {
    version: 1,
    seed: normalizeSeed(seed),
    tick: 0,
    players,
    traffic: generateTraffic(seed, options.trafficDensityPerLaneKm),
    collisionCooldowns: {},
    result: null,
  };
}

/**
 * Advances the supplied authoritative state exactly one 1/60-second tick.
 * The state is mutated intentionally to avoid per-tick garbage in a game server.
 */
export function stepSimulation(
  state: SimulationState,
  inputs: InputsByPlayer = {},
): SimulationStep {
  if (state.result) return { state, events: [] };

  state.tick += 1;
  const events: SimulationEvent[] = [];
  const previousPlayerPositions = new Map(
    state.players.map((player) => [player.id, { x: player.lateralPosition, z: player.distance }]),
  );
  const previousTrafficDistances = new Map(
    state.traffic.map((vehicle) => [vehicle.id, vehicle.distance]),
  );

  decrementCollisionCooldowns(state.collisionCooldowns);

  for (const vehicle of state.traffic) {
    vehicle.distance += vehicle.speed * FIXED_TIME_STEP_SECONDS;
  }

  for (const player of state.players) {
    if (player.status === "knockedDown") {
      player.respawnTicksRemaining = Math.max(0, player.respawnTicksRemaining - 1);
      if (player.respawnTicksRemaining === 0) respawnPlayer(state, player, events);
      continue;
    }
    if (player.status !== "racing") continue;

    integratePlayer(player, normalizeInput(inputs[player.id]));
    constrainPlayerToRoad(player);
  }

  resolveTrafficCollisions(state, previousPlayerPositions, previousTrafficDistances, events);
  resolvePlayerCollision(state, previousPlayerPositions, events);
  resolveFinish(state, previousPlayerPositions, events);

  for (const player of state.players) {
    if (player.status === "racing" && player.immunityTicksRemaining > 0) {
      player.immunityTicksRemaining -= 1;
    }
  }

  return { state, events };
}

export class RaceSimulation {
  readonly state: SimulationState;

  constructor(playerIds: readonly string[], seed: number, options?: CreateSimulationOptions) {
    this.state = createSimulationState(playerIds, seed, options);
  }

  step(inputs: InputsByPlayer = {}): SimulationStep {
    return stepSimulation(this.state, inputs);
  }

  snapshot(): SimulationState {
    return cloneSimulationState(this.state);
  }
}

export function cloneSimulationState(state: SimulationState): SimulationState {
  return {
    version: 1,
    seed: state.seed,
    tick: state.tick,
    players: state.players.map((player) => ({
      ...player,
      finish: player.finish ? { ...player.finish } : null,
    })),
    traffic: state.traffic.map((vehicle) => ({ ...vehicle })),
    collisionCooldowns: { ...state.collisionCooldowns },
    result: state.result
      ? {
          completedAtTick: state.result.completedAtTick,
          winnerIds: [...state.result.winnerIds],
          rankings: state.result.rankings.map((ranking) => ({
            ...ranking,
            finish: ranking.finish ? { ...ranking.finish } : null,
          })),
        }
      : null,
  };
}

function integratePlayer(player: PlayerState, input: RiderInput): void {
  const speedRatio = player.longitudinalSpeed / MAX_SPEED_METERS_PER_SECOND;
  // Braking has priority over throttle. This prevents a held accelerator (or a
  // stale input packet) from making the motorcycle push against the brakes.
  const engine =
    input.brake > 0 ? 0 : input.throttle * ENGINE_ACCELERATION * Math.max(0, 1 - speedRatio ** 1.7);
  const brake = input.brake * BRAKE_DECELERATION;
  const drag =
    player.longitudinalSpeed > 0
      ? ROLLING_RESISTANCE + AERODYNAMIC_DRAG * player.longitudinalSpeed ** 2
      : 0;

  player.longitudinalSpeed = clamp(
    player.longitudinalSpeed + (engine - brake - drag) * FIXED_TIME_STEP_SECONDS,
    0,
    MAX_SPEED_METERS_PER_SECOND,
  );

  const steeringAuthority = clamp(player.longitudinalSpeed / 6, 0, 1);
  const targetLateralSpeed =
    input.steer * Math.min(9, 2.2 + player.longitudinalSpeed * 0.095) * steeringAuthority;
  player.lateralSpeed = moveTowards(
    player.lateralSpeed,
    targetLateralSpeed,
    MAX_LATERAL_ACCELERATION * FIXED_TIME_STEP_SECONDS,
  );

  player.distance += player.longitudinalSpeed * FIXED_TIME_STEP_SECONDS;
  player.lateralPosition += player.lateralSpeed * FIXED_TIME_STEP_SECONDS;
  player.headingRadians = Math.atan2(player.lateralSpeed, Math.max(1, player.longitudinalSpeed));
}

function constrainPlayerToRoad(player: PlayerState): void {
  const lateralLimit = ROAD_HALF_WIDTH_METERS - BIKE_ROAD_MARGIN;
  if (player.lateralPosition < -lateralLimit) {
    player.lateralPosition = -lateralLimit;
    player.lateralSpeed = Math.max(0, player.lateralSpeed);
  } else if (player.lateralPosition > lateralLimit) {
    player.lateralPosition = lateralLimit;
    player.lateralSpeed = Math.min(0, player.lateralSpeed);
  }
}

function resolveTrafficCollisions(
  state: SimulationState,
  previousPlayers: ReadonlyMap<string, { x: number; z: number }>,
  previousTraffic: ReadonlyMap<string, number>,
  events: SimulationEvent[],
): void {
  for (const player of state.players) {
    if (player.status !== "racing" || player.immunityTicksRemaining > 0) continue;
    const previousPlayer = previousPlayers.get(player.id)!;

    for (const traffic of state.traffic) {
      const key = contactKey(player.id, traffic.id);
      if (state.collisionCooldowns[key]) continue;
      const previousTrafficDistance = previousTraffic.get(traffic.id)!;
      if (
        !sweptBoxesOverlap(
          previousPlayer.x,
          previousPlayer.z,
          player.lateralPosition,
          player.distance,
          BIKE_WIDTH_METERS / 2 + traffic.width / 2,
          BIKE_LENGTH_METERS / 2 + traffic.length / 2,
          traffic.lateralPosition,
          previousTrafficDistance,
          traffic.lateralPosition,
          traffic.distance,
        )
      ) {
        continue;
      }

      const impactSpeed = Math.hypot(player.longitudinalSpeed - traffic.speed, player.lateralSpeed);
      const severity = impactSpeed >= HARD_COLLISION_SPEED_METERS_PER_SECOND ? "hard" : "soft";
      events.push({
        type: "collision",
        tick: state.tick,
        playerIds: [player.id],
        targetType: "traffic",
        targetId: traffic.id,
        impactSpeed,
        severity,
      });
      state.collisionCooldowns[key] = SOFT_COLLISION_COOLDOWN_TICKS;

      if (severity === "hard") {
        knockDownPlayer(player, state.tick, impactSpeed, events);
      } else {
        resolveSoftTrafficContact(player, traffic);
      }
      break;
    }
  }
}

function resolvePlayerCollision(
  state: SimulationState,
  previousPlayers: ReadonlyMap<string, { x: number; z: number }>,
  events: SimulationEvent[],
): void {
  if (state.players.length !== 2) return;
  const first = state.players[0]!;
  const second = state.players[1]!;
  if (
    first.status !== "racing" ||
    second.status !== "racing" ||
    first.immunityTicksRemaining > 0 ||
    second.immunityTicksRemaining > 0
  ) {
    return;
  }

  const key = contactKey(first.id, second.id);
  if (state.collisionCooldowns[key]) return;
  const previousFirst = previousPlayers.get(first.id)!;
  const previousSecond = previousPlayers.get(second.id)!;
  if (
    !sweptBoxesOverlap(
      previousFirst.x,
      previousFirst.z,
      first.lateralPosition,
      first.distance,
      BIKE_WIDTH_METERS,
      BIKE_LENGTH_METERS,
      previousSecond.x,
      previousSecond.z,
      second.lateralPosition,
      second.distance,
    )
  ) {
    return;
  }

  const impactSpeed = Math.hypot(
    first.longitudinalSpeed - second.longitudinalSpeed,
    first.lateralSpeed - second.lateralSpeed,
  );
  const severity = impactSpeed >= HARD_COLLISION_SPEED_METERS_PER_SECOND ? "hard" : "soft";
  events.push({
    type: "collision",
    tick: state.tick,
    playerIds: [first.id, second.id],
    targetType: "player",
    targetId: second.id,
    impactSpeed,
    severity,
  });
  state.collisionCooldowns[key] = SOFT_COLLISION_COOLDOWN_TICKS;

  if (severity === "hard") {
    knockDownPlayer(first, state.tick, impactSpeed, events);
    knockDownPlayer(second, state.tick, impactSpeed, events);
    return;
  }

  const averageLongitudinalSpeed = (first.longitudinalSpeed + second.longitudinalSpeed) / 2;
  first.longitudinalSpeed = averageLongitudinalSpeed;
  second.longitudinalSpeed = averageLongitudinalSpeed;
  const pushDirection = first.lateralPosition <= second.lateralPosition ? -1 : 1;
  first.lateralSpeed = pushDirection * 1.4;
  second.lateralSpeed = -pushDirection * 1.4;
}

function resolveSoftTrafficContact(player: PlayerState, traffic: TrafficVehicleState): void {
  player.longitudinalSpeed = Math.max(
    0,
    traffic.speed + (player.longitudinalSpeed - traffic.speed) * 0.35,
  );
  const pushDirection = player.lateralPosition <= traffic.lateralPosition ? -1 : 1;
  player.lateralSpeed = pushDirection * Math.max(1.2, Math.abs(player.lateralSpeed) * 0.5);
}

function knockDownPlayer(
  player: PlayerState,
  tick: number,
  impactSpeed: number,
  events: SimulationEvent[],
): void {
  if (player.status !== "racing") return;
  player.status = "knockedDown";
  player.longitudinalSpeed = 0;
  player.lateralSpeed = 0;
  player.headingRadians = 0;
  player.respawnTicksRemaining = RESPAWN_TICKS;
  player.immunityTicksRemaining = 0;
  player.distance = Math.min(player.distance, TRACK_LENGTH_METERS - 0.001);
  events.push({ type: "knockdown", tick, playerId: player.id, impactSpeed });
}

function respawnPlayer(
  state: SimulationState,
  player: PlayerState,
  events: SimulationEvent[],
): void {
  player.status = "racing";
  player.lateralPosition = findSafestRespawnLane(state, player);
  player.longitudinalSpeed = 10;
  player.lateralSpeed = 0;
  player.headingRadians = 0;
  // The common end-of-tick timer pass also runs on the respawn tick.
  player.immunityTicksRemaining = RESPAWN_IMMUNITY_TICKS + 1;
  events.push({
    type: "respawn",
    tick: state.tick,
    playerId: player.id,
    lateralPosition: player.lateralPosition,
  });
}

function findSafestRespawnLane(state: SimulationState, player: PlayerState): number {
  let safestLane: number = LANE_CENTERS_METERS[0];
  let greatestClearance = -1;

  for (const lane of LANE_CENTERS_METERS) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const traffic of state.traffic) {
      if (Math.abs(traffic.lateralPosition - lane) > 1.2) continue;
      nearest = Math.min(nearest, Math.abs(traffic.distance - player.distance));
    }
    for (const other of state.players) {
      if (other.id === player.id || other.status === "knockedDown") continue;
      if (Math.abs(other.lateralPosition - lane) > 1) continue;
      nearest = Math.min(nearest, Math.abs(other.distance - player.distance));
    }
    if (nearest > greatestClearance) {
      safestLane = lane;
      greatestClearance = nearest;
    }
  }
  return safestLane;
}

function resolveFinish(
  state: SimulationState,
  previousPlayers: ReadonlyMap<string, { x: number; z: number }>,
  events: SimulationEvent[],
): void {
  const newlyFinished: PlayerState[] = [];
  for (const player of state.players) {
    if (player.status !== "racing" || player.distance < TRACK_LENGTH_METERS) continue;
    const previousDistance = previousPlayers.get(player.id)!.z;
    const distanceThisTick = player.distance - previousDistance;
    const subTick = clamp(
      distanceThisTick > 0 ? (TRACK_LENGTH_METERS - previousDistance) / distanceThisTick : 1,
      0,
      1,
    );
    const finish: FinishTime = {
      tick: state.tick,
      subTick,
      seconds: (state.tick - 1 + subTick) / TICK_RATE,
    };
    player.finish = finish;
    player.status = "finished";
    player.distance = TRACK_LENGTH_METERS;
    newlyFinished.push(player);
    events.push({ type: "finish", tick: state.tick, playerId: player.id, finish });
  }

  if (newlyFinished.length === 0) return;
  newlyFinished.sort(compareFinishedPlayers);
  const winningTime = newlyFinished[0]!.finish!.seconds;
  const winnerIds = newlyFinished
    .filter((player) => Math.abs(player.finish!.seconds - winningTime) <= Number.EPSILON * 16)
    .map((player) => player.id)
    .sort();
  const result: RaceResult = {
    completedAtTick: state.tick,
    winnerIds,
    rankings: createRankings(state.players),
  };
  state.result = result;
  events.push({ type: "raceFinished", tick: state.tick, result });
}

function createRankings(players: readonly PlayerState[]): RaceRanking[] {
  const ordered = [...players].sort((left, right) => {
    if (left.finish && right.finish) return compareFinishedPlayers(left, right);
    if (left.finish) return -1;
    if (right.finish) return 1;
    return right.distance - left.distance || left.id.localeCompare(right.id);
  });

  return ordered.map((player, index) => {
    const previous = ordered[index - 1];
    const tiedWithPrevious = Boolean(
      previous?.finish && player.finish && previous.finish.seconds === player.finish.seconds,
    );
    return {
      playerId: player.id,
      position: tiedWithPrevious ? index : index + 1,
      finished: player.finish !== null,
      distance: player.distance,
      finish: player.finish ? { ...player.finish } : null,
    };
  });
}

function compareFinishedPlayers(left: PlayerState, right: PlayerState): number {
  return left.finish!.seconds - right.finish!.seconds || left.id.localeCompare(right.id);
}

function sweptBoxesOverlap(
  firstStartX: number,
  firstStartZ: number,
  firstEndX: number,
  firstEndZ: number,
  combinedHalfWidth: number,
  combinedHalfLength: number,
  secondStartX: number,
  secondStartZ: number,
  secondEndX: number,
  secondEndZ: number,
): boolean {
  const relativeStartX = firstStartX - secondStartX;
  const relativeStartZ = firstStartZ - secondStartZ;
  const relativeDeltaX = firstEndX - firstStartX - (secondEndX - secondStartX);
  const relativeDeltaZ = firstEndZ - firstStartZ - (secondEndZ - secondStartZ);
  const xInterval = axisIntersection(relativeStartX, relativeDeltaX, combinedHalfWidth);
  const zInterval = axisIntersection(relativeStartZ, relativeDeltaZ, combinedHalfLength);
  return (
    Math.max(xInterval.entry, zInterval.entry, 0) <= Math.min(xInterval.exit, zInterval.exit, 1)
  );
}

function axisIntersection(
  start: number,
  delta: number,
  extent: number,
): { entry: number; exit: number } {
  if (Math.abs(delta) < 1e-12) {
    return Math.abs(start) <= extent
      ? { entry: Number.NEGATIVE_INFINITY, exit: Number.POSITIVE_INFINITY }
      : { entry: Number.POSITIVE_INFINITY, exit: Number.NEGATIVE_INFINITY };
  }
  const first = (-extent - start) / delta;
  const second = (extent - start) / delta;
  return { entry: Math.min(first, second), exit: Math.max(first, second) };
}

function decrementCollisionCooldowns(cooldowns: Record<string, number>): void {
  for (const [key, ticks] of Object.entries(cooldowns)) {
    if (ticks <= 1) delete cooldowns[key];
    else cooldowns[key] = ticks - 1;
  }
}

function contactKey(firstId: string, secondId: string): string {
  return firstId < secondId ? `${firstId}|${secondId}` : `${secondId}|${firstId}`;
}

function validatePlayerIds(playerIds: readonly string[]): void {
  if (playerIds.length < 1 || playerIds.length > MAX_PLAYERS) {
    throw new RangeError(`Simulation requires between 1 and ${MAX_PLAYERS} players.`);
  }
  if (playerIds.some((id) => id.trim().length === 0)) {
    throw new TypeError("Player ids must be non-empty strings.");
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new TypeError("Player ids must be unique.");
  }
}

function clampFinite(value: number | undefined, min: number, max: number): number {
  return Number.isFinite(value) ? clamp(value!, min, max) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}
