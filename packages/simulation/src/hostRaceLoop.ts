import {
  ARCADE_COUNTDOWN_MS,
  ARCADE_RACE_DISTANCE_METERS,
  ARCADE_PLAYER_STARTS,
  advanceArcadePlayer,
  applyArcadeTrafficCollisions,
  idleArcadeInput,
  type ArcadeInput,
  type ArcadePlayerState,
} from "./arcadeRace";
import { generateTraffic } from "./traffic";
import type { TrafficVehicleState } from "./types";

export type HostRacePhase = "waiting" | "countdown" | "racing" | "finished";

export interface HostPlayerSim extends ArcadePlayerState {
  id: string;
  slot: number;
  finished: boolean;
  finishTimeMs: number;
  lastInputTick: number;
}

export interface HostRaceLoopState {
  phase: HostRacePhase;
  tick: number;
  countdownMs: number;
  elapsedMs: number;
  winnerId: string;
  seed: number;
  traffic: TrafficVehicleState[];
  trafficCooldowns: Map<string, number>;
  players: Map<string, HostPlayerSim>;
  pendingInputs: Map<string, ArcadeInput>;
}

export function createHostPlayer(id: string, slot: number): HostPlayerSim {
  return {
    id,
    slot,
    lateralPosition: ARCADE_PLAYER_STARTS[slot] ?? 0,
    distance: 0,
    speed: 0,
    lean: 0,
    finished: false,
    finishTimeMs: 0,
    lastInputTick: 0,
    hitstunMs: 0,
  };
}

export function ensureHostPlayer(state: HostRaceLoopState, id: string, slot: number): void {
  if (state.players.has(id)) return;
  state.players.set(id, createHostPlayer(id, slot));
}

export function createHostRaceLoop(hostId: string, guestId?: string, seed = 42): HostRaceLoopState {
  const players = new Map<string, HostPlayerSim>();
  players.set(hostId, createHostPlayer(hostId, 0));
  if (guestId) players.set(guestId, createHostPlayer(guestId, 1));

  return {
    phase: "waiting",
    tick: 0,
    countdownMs: 0,
    elapsedMs: 0,
    winnerId: "",
    seed,
    traffic: generateTraffic(seed),
    trafficCooldowns: new Map(),
    players,
    pendingInputs: new Map(),
  };
}

export function setHostRaceSeed(state: HostRaceLoopState, seed: number): void {
  const next = seed || 42;
  if (next === state.seed && state.traffic.length > 0) return;
  state.seed = next;
  state.traffic = generateTraffic(next);
  state.trafficCooldowns.clear();
}

export function queueHostInput(
  state: HostRaceLoopState,
  playerId: string,
  input: ArcadeInput,
): void {
  const player = state.players.get(playerId);
  if (!player) return;
  if (input.tick <= player.lastInputTick) return;
  player.lastInputTick = input.tick;
  state.pendingInputs.set(playerId, input);
}

export function startHostCountdown(state: HostRaceLoopState): void {
  if (state.phase !== "waiting") return;
  state.phase = "countdown";
  state.countdownMs = ARCADE_COUNTDOWN_MS;
}

export function stepHostRace(state: HostRaceLoopState, deltaMs: number): void {
  state.tick += 1;

  if (state.phase === "countdown") {
    state.countdownMs = Math.max(0, state.countdownMs - deltaMs);
    if (state.countdownMs === 0) state.phase = "racing";
    return;
  }

  if (state.phase !== "racing") return;

  state.elapsedMs += deltaMs;
  const deltaSeconds = deltaMs / 1_000;

  for (const [playerId, player] of state.players) {
    if (player.finished) continue;
    player.hitstunMs = Math.max(0, (player.hitstunMs ?? 0) - deltaMs);
    const queued = state.pendingInputs.get(playerId) ?? idleArcadeInput(state.tick);
    const input = (player.hitstunMs ?? 0) > 0 ? { ...queued, throttle: 0, boost: false } : queued;
    advanceArcadePlayer(player, input, deltaSeconds);
    applyArcadeTrafficCollisions(
      player,
      state.traffic,
      state.elapsedMs / 1_000,
      state.trafficCooldowns,
      state.elapsedMs,
      player.id,
    );
    if (player.distance >= ARCADE_RACE_DISTANCE_METERS) finishHostPlayer(state, player);
  }
}

function finishHostPlayer(state: HostRaceLoopState, player: HostPlayerSim): void {
  if (player.finished) return;
  player.finished = true;
  player.finishTimeMs = state.elapsedMs;
  player.distance = ARCADE_RACE_DISTANCE_METERS;
  if (!state.winnerId) {
    state.winnerId = player.id;
    state.phase = "finished";
  }
}

export type HostSnapshotPlayer = {
  id: string;
  distance: number;
  lateralPosition: number;
  speed: number;
};

export type HostRaceSnapshot = {
  seq: number;
  phase: HostRacePhase;
  elapsedMs: number;
  countdownMs: number;
  winnerId: string;
  players: HostSnapshotPlayer[];
};

export function hostSnapshotPlayers(state: HostRaceLoopState): HostSnapshotPlayer[] {
  return [...state.players.values()].map((player) => ({
    id: player.id,
    distance: player.distance,
    lateralPosition: player.lateralPosition,
    speed: player.speed,
  }));
}

export function createHostSnapshot(state: HostRaceLoopState, seq: number): HostRaceSnapshot {
  return {
    seq,
    phase: state.phase,
    elapsedMs: state.elapsedMs,
    countdownMs: state.countdownMs,
    winnerId: state.winnerId,
    players: hostSnapshotPlayers(state),
  };
}
