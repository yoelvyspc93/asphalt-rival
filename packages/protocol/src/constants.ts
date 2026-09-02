export const PROTOCOL_VERSION = 1 as const;
export const PRIVATE_RACE_ROOM = "private_race" as const;

export const CLIENT_MESSAGE = {
  input: "player:input",
  ready: "player:ready",
  ping: "connection:ping",
} as const;

export const SERVER_MESSAGE = {
  roomInfo: "room:info",
  raceEvent: "race:event",
  protocolError: "protocol:error",
  pong: "connection:pong",
} as const;

export const MAX_PLAYERS = 2 as const;
export const SERVER_TICK_RATE = 60 as const;
export const STATE_PATCH_RATE_MS = 50 as const;
export const RACE_DISTANCE_METERS = 5_000 as const;
export const COUNTDOWN_MS = 3_000 as const;
