import type { RacePhase } from "./state";

export interface RaceRoomOptions {
  displayName?: string;
  bikeColor?: string;
  protocolVersion?: number;
}

export interface PlayerInputMessage {
  tick: number;
  throttle: number;
  brake: number;
  steering: number;
  boost: boolean;
}

export interface PlayerReadyMessage {
  ready: boolean;
}

export interface PingMessage {
  clientTime: number;
}

export interface RoomInfoMessage {
  roomId: string;
  inviteCode: string;
  sessionId: string;
  protocolVersion: number;
  tickRate: number;
}

export type RaceEventMessage =
  | { type: "countdown"; startsInMs: number }
  | { type: "started"; serverTick: number }
  | { type: "finished"; winnerSessionId: string; elapsedMs: number }
  | { type: "opponent-disconnected"; sessionId: string };

export interface ProtocolErrorMessage {
  code: "INVALID_MESSAGE" | "PROTOCOL_MISMATCH" | "RACE_ALREADY_STARTED";
  message: string;
}

export interface PongMessage {
  clientTime: number;
  serverTime: number;
  serverTick: number;
}

export interface MatchSummary {
  phase: RacePhase;
  winnerSessionId: string;
  elapsedMs: number;
}

