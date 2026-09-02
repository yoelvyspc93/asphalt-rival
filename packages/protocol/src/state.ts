import { MapSchema, Schema, type } from "@colyseus/schema";

export type RacePhase = "waiting" | "countdown" | "racing" | "finished";

export class PlayerState extends Schema {
  @type("string") sessionId = "";
  @type("string") displayName = "Piloto";
  @type("string") bikeColor = "#ff5a36";
  @type("uint8") slot = 0;
  @type("boolean") ready = false;
  @type("boolean") connected = true;
  @type("boolean") finished = false;
  @type("float32") lateralPosition = 0;
  @type("float32") distance = 0;
  @type("float32") speed = 0;
  @type("float32") lean = 0;
  @type("uint32") finishTimeMs = 0;
  @type("uint32") lastInputTick = 0;
}

export class TrafficState extends Schema {
  @type("string") id = "";
  @type("string") kind = "car";
  @type("uint8") laneIndex = 0;
  @type("float32") lateralPosition = 0;
  @type("float32") distance = 0;
  @type("float32") speed = 0;
  @type("float32") width = 0;
  @type("float32") length = 0;
}

export class RaceState extends Schema {
  @type("string") phase: RacePhase = "waiting";
  @type("string") roomCode = "";
  @type("uint32") protocolVersion = 1;
  @type("uint32") seed = 0;
  @type("uint32") tick = 0;
  @type("uint32") countdownMs = 0;
  @type("uint32") elapsedMs = 0;
  @type("string") winnerSessionId = "";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: TrafficState }) traffic = new MapSchema<TrafficState>();
}

