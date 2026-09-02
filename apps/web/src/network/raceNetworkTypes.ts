export type RaceInput = {
  throttle: number;
  brake: number;
  steer: number;
  timestamp: number;
};

export type RivalSnapshot = {
  distance: number;
  laneOffset: number;
  speed: number;
  timestamp: number;
};

export type NetworkStatus = "desconectado" | "conectando" | "conectado" | "demo-local";
export type OnlineRacePhase = "waiting" | "countdown" | "racing" | "finished";

export type LobbyPlayer = {
  sessionId: string;
  displayName: string;
  ready: boolean;
  connected: boolean;
  local: boolean;
};

export type RaceConnectionState = {
  status: NetworkStatus;
  roomCode: string;
  sessionId: string;
  phase: OnlineRacePhase;
  countdownMs: number;
  elapsedMs: number;
  winnerSessionId: string;
  players: LobbyPlayer[];
  error: string;
};

export interface RaceNetworkAdapter {
  readonly status: NetworkStatus;
  createRoom?(displayName: string): Promise<void>;
  joinRoom?(roomCode: string, displayName: string): Promise<void>;
  setReady?(ready: boolean): void;
  connect?(roomCode: string): Promise<void>;
  sendInput(input: RaceInput): void;
  subscribeToRival(listener: (snapshot: RivalSnapshot) => void): () => void;
  subscribeToState?(listener: (state: RaceConnectionState) => void): () => void;
  disconnect(): void;
}

export const INITIAL_CONNECTION: RaceConnectionState = {
  status: "desconectado",
  roomCode: "",
  sessionId: "",
  phase: "waiting",
  countdownMs: 0,
  elapsedMs: 0,
  winnerSessionId: "",
  players: [],
  error: "",
};

/**
 * Small integration layer. The visual client works without a server and any
 * WebSocket/WebRTC adapter can replace this class without touching the scene.
 */
export class LocalDemoNetwork implements RaceNetworkAdapter {
  readonly status = "demo-local" as const;

  async connect(_roomCode: string) {
    await Promise.resolve();
  }

  sendInput(_input: RaceInput) {}

  subscribeToRival(_listener: (snapshot: RivalSnapshot) => void) {
    return () => undefined;
  }

  disconnect() {}
}
