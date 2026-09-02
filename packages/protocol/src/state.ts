import { MapSchema, Schema, defineTypes } from "@colyseus/schema";

export type RacePhase = "waiting" | "countdown" | "racing" | "finished";

export class PlayerState extends Schema {
  sessionId = "";
  displayName = "Piloto";
  bikeColor = "#ff5a36";
  slot = 0;
  ready = false;
  connected = true;
  finished = false;
  lateralPosition = 0;
  distance = 0;
  speed = 0;
  lean = 0;
  finishTimeMs = 0;
  lastInputTick = 0;
}

defineTypes(PlayerState, {
  sessionId: "string",
  displayName: "string",
  bikeColor: "string",
  slot: "uint8",
  ready: "boolean",
  connected: "boolean",
  finished: "boolean",
  lateralPosition: "float32",
  distance: "float32",
  speed: "float32",
  lean: "float32",
  finishTimeMs: "uint32",
  lastInputTick: "uint32",
});

export class TrafficState extends Schema {
  id = "";
  kind = "car";
  laneIndex = 0;
  lateralPosition = 0;
  distance = 0;
  speed = 0;
  width = 0;
  length = 0;
}

defineTypes(TrafficState, {
  id: "string",
  kind: "string",
  laneIndex: "uint8",
  lateralPosition: "float32",
  distance: "float32",
  speed: "float32",
  width: "float32",
  length: "float32",
});

export class RaceState extends Schema {
  phase: RacePhase = "waiting";
  roomCode = "";
  protocolVersion = 1;
  seed = 0;
  tick = 0;
  countdownMs = 0;
  elapsedMs = 0;
  winnerSessionId = "";
  players = new MapSchema<PlayerState>();
  traffic = new MapSchema<TrafficState>();
}

defineTypes(RaceState, {
  phase: "string",
  roomCode: "string",
  protocolVersion: "uint32",
  seed: "uint32",
  tick: "uint32",
  countdownMs: "uint32",
  elapsedMs: "uint32",
  winnerSessionId: "string",
  players: { map: PlayerState },
  traffic: { map: TrafficState },
});
