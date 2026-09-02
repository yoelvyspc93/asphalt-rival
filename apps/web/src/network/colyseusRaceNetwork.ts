import { Client, type Room } from "@colyseus/sdk";

import {
  INITIAL_CONNECTION,
  type LobbyPlayer,
  type OnlineRacePhase,
  type RaceConnectionState,
  type RaceInput,
  type RaceNetworkAdapter,
  type RivalSnapshot,
} from "./raceNetworkTypes";

type PlayerSchema = {
  sessionId: string;
  displayName: string;
  ready: boolean;
  connected: boolean;
  lateralPosition: number;
  distance: number;
  speed: number;
};

type RaceSchema = {
  phase: OnlineRacePhase;
  roomCode: string;
  countdownMs: number;
  elapsedMs: number;
  winnerSessionId: string;
  players: {
    get(sessionId: string): PlayerSchema | undefined;
    forEach(callback: (player: PlayerSchema, sessionId: string) => void): void;
  };
};

type RaceEvent =
  | { type: "countdown"; startsInMs: number }
  | { type: "started"; serverTick: number }
  | { type: "finished"; winnerSessionId: string; elapsedMs: number }
  | { type: "opponent-disconnected"; sessionId: string };

function defaultEndpoint() {
  const environment = (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
    .env;
  const configured = environment?.VITE_COLYSEUS_URL;
  if (configured) return configured;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:2567`;
}

function normalizeName(name: string) {
  return name.trim().slice(0, 20) || "VÉRTICE";
}

function normalizeRoomCode(roomCode: string) {
  return roomCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .slice(0, 6);
}

function readableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found|invalid room|4212/i.test(message)) return "No existe una sala con ese código.";
  if (/full|4211/i.test(message)) return "La sala ya tiene dos pilotos.";
  if (/locked|4213/i.test(message)) return "La carrera de esa sala ya comenzó.";
  if (/failed to fetch|network|websocket|connection/i.test(message))
    return "No se pudo contactar con el servidor. Puedes usar la demo local.";
  return message || "No se pudo completar la conexión.";
}

/** Optional local-dev adapter backed by the Colyseus Node server. */
export class ColyseusRaceNetwork implements RaceNetworkAdapter {
  private readonly client: Client;
  private room: Room<any, RaceSchema> | null = null;
  private state: RaceConnectionState = INITIAL_CONNECTION;
  private tick = 0;
  private intentionalLeave = false;
  private readonly stateListeners = new Set<(state: RaceConnectionState) => void>();
  private readonly rivalListeners = new Set<(snapshot: RivalSnapshot) => void>();

  constructor(endpoint = defaultEndpoint()) {
    this.client = new Client(endpoint);
  }

  get status() {
    return this.state.status;
  }

  async createRoom(displayName: string) {
    await this.openRoom(() =>
      this.client.create<RaceSchema>("private_race", {
        displayName: normalizeName(displayName),
        protocolVersion: 1,
      }),
    );
  }

  async joinRoom(roomCode: string, displayName: string) {
    const normalized = normalizeRoomCode(roomCode);
    if (normalized.length !== 6) {
      this.update({ error: "El código de sala debe tener seis caracteres." });
      return;
    }
    await this.openRoom(() =>
      this.client.joinById<RaceSchema>(normalized, {
        displayName: normalizeName(displayName),
        protocolVersion: 1,
      }),
    );
  }

  setReady(ready: boolean) {
    this.room?.send("player:ready", { ready });
  }

  sendInput(input: RaceInput) {
    if (!this.room || this.state.phase !== "racing") return;
    this.tick += 1;
    this.room.send("player:input", {
      tick: this.tick,
      throttle: input.throttle,
      brake: input.brake,
      steering: input.steer,
      boost: false,
    });
  }

  subscribeToRival(listener: (snapshot: RivalSnapshot) => void) {
    this.rivalListeners.add(listener);
    return () => {
      this.rivalListeners.delete(listener);
    };
  }

  subscribeToState(listener: (state: RaceConnectionState) => void) {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  disconnect() {
    this.intentionalLeave = true;
    const room = this.room;
    this.room = null;
    this.tick = 0;
    this.state = INITIAL_CONNECTION;
    this.emitState();
    if (room) void room.leave(true);
  }

  private async openRoom(connect: () => Promise<Room<any, RaceSchema>>) {
    this.disconnect();
    this.intentionalLeave = false;
    this.update({ status: "conectando", error: "" });

    try {
      const room = await connect();
      this.room = room;
      this.tick = 0;
      this.attachRoom(room);
      this.update({
        status: "conectado",
        roomCode: room.roomId,
        sessionId: room.sessionId,
        error: "",
      });
      this.consumeState(room.state);
    } catch (error) {
      this.room = null;
      this.update({ status: "desconectado", error: readableError(error) });
    }
  }

  private attachRoom(room: Room<any, RaceSchema>) {
    room.onStateChange((state) => this.consumeState(state));
    room.onMessage<RaceEvent>("race:event", (event) => {
      if (event.type === "countdown")
        this.update({ phase: "countdown", countdownMs: event.startsInMs });
      if (event.type === "started") this.update({ phase: "racing", countdownMs: 0 });
      if (event.type === "finished")
        this.update({
          phase: "finished",
          winnerSessionId: event.winnerSessionId,
          elapsedMs: event.elapsedMs,
        });
      if (event.type === "opponent-disconnected")
        this.update({ error: "El rival se desconectó de la carrera." });
    });
    room.onMessage<{ message: string }>("protocol:error", (error) => {
      this.update({ error: error.message });
    });
    room.onError((_code, message) => {
      this.update({ error: message || "La conexión con la sala tuvo un error." });
    });
    room.onLeave((_code, reason) => {
      if (this.room !== room) return;
      this.room = null;
      if (!this.intentionalLeave)
        this.update({
          status: "desconectado",
          error: reason || "Se perdió la conexión con la sala.",
        });
    });
  }

  private consumeState(state: RaceSchema) {
    if (!state?.players) return;
    const players: LobbyPlayer[] = [];
    state.players.forEach((player, sessionId) => {
      players.push({
        sessionId,
        displayName: player.displayName,
        ready: player.ready,
        connected: player.connected,
        local: sessionId === this.room?.sessionId,
      });
    });
    players.sort((a, b) => Number(b.local) - Number(a.local));

    const localSessionId = this.room?.sessionId ?? this.state.sessionId;
    let rival: PlayerSchema | undefined;
    state.players.forEach((player, sessionId) => {
      if (sessionId !== localSessionId) rival = player;
    });
    if (rival) {
      const snapshot = {
        distance: rival.distance,
        laneOffset: rival.lateralPosition,
        speed: rival.speed * 3.6,
        timestamp: performance.now(),
      };
      this.rivalListeners.forEach((listener) => listener(snapshot));
    }

    this.update({
      roomCode: state.roomCode || this.room?.roomId || this.state.roomCode,
      sessionId: localSessionId,
      phase: state.phase,
      countdownMs: state.countdownMs,
      elapsedMs: state.elapsedMs,
      winnerSessionId: state.winnerSessionId,
      players,
    });
  }

  private update(patch: Partial<RaceConnectionState>) {
    this.state = { ...this.state, ...patch };
    this.emitState();
  }

  private emitState() {
    this.stateListeners.forEach((listener) => listener(this.state));
  }
}
