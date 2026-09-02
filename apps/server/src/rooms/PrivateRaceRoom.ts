import { randomInt } from "node:crypto";
import type { Client } from "colyseus";
import { Room } from "colyseus";
import {
  CLIENT_MESSAGE,
  COUNTDOWN_MS,
  MAX_PLAYERS,
  PlayerState,
  PROTOCOL_VERSION,
  RACE_DISTANCE_METERS,
  RaceState,
  SERVER_MESSAGE,
  SERVER_TICK_RATE,
  STATE_PATCH_RATE_MS,
  parsePing,
  parsePlayerInput,
  parsePlayerReady,
  parseRaceRoomOptions,
  sanitizeBikeColor,
  sanitizeDisplayName,
  type PlayerInputMessage,
  type ProtocolErrorMessage,
  type RaceEventMessage,
  type RaceRoomOptions,
  type RoomInfoMessage,
} from "@game-moto/protocol";
import { advancePlayer, idleInput } from "./raceMath";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createRoomCode(): string {
  return Array.from(
    { length: 6 },
    () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)],
  ).join("");
}

const PLAYER_COLORS = ["#ff5a36", "#29c7ff"] as const;
const PLAYER_STARTS = [-1.55, 1.55] as const;
const MAX_INPUT_LEAD_TICKS = SERVER_TICK_RATE * 2;

export class PrivateRaceRoom extends Room<{ state: RaceState }> {
  override maxClients = MAX_PLAYERS;
  override state = new RaceState();
  private readonly pendingInputs = new Map<string, PlayerInputMessage>();

  override async onCreate(): Promise<void> {
    this.roomId = createRoomCode();
    this.state.roomCode = this.roomId;
    this.state.protocolVersion = PROTOCOL_VERSION;
    this.state.seed = randomInt(1, 0xffff_ffff);
    this.patchRate = STATE_PATCH_RATE_MS;
    this.maxMessagesPerSecond = 90;
    await this.setPrivate(true);

    this.onMessage(CLIENT_MESSAGE.input, (client, payload: unknown) => {
      const input = parsePlayerInput(payload);
      const player = this.state.players.get(client.sessionId);
      if (!input || !player) return this.sendInvalidMessage(client);
      if (input.tick <= player.lastInputTick || input.tick > this.state.tick + MAX_INPUT_LEAD_TICKS)
        return;
      player.lastInputTick = input.tick;
      this.pendingInputs.set(client.sessionId, input);
    });

    this.onMessage(CLIENT_MESSAGE.ready, (client, payload: unknown) => {
      const message = parsePlayerReady(payload);
      const player = this.state.players.get(client.sessionId);
      if (!message || !player) return this.sendInvalidMessage(client);
      if (this.state.phase !== "waiting") {
        return client.send(SERVER_MESSAGE.protocolError, {
          code: "RACE_ALREADY_STARTED",
          message: "La carrera ya ha comenzado.",
        } satisfies ProtocolErrorMessage);
      }
      player.ready = message.ready;
      this.tryStartCountdown();
    });

    this.onMessage(CLIENT_MESSAGE.ping, (client, payload: unknown) => {
      const message = parsePing(payload);
      if (!message) return this.sendInvalidMessage(client);
      client.send(SERVER_MESSAGE.pong, {
        clientTime: message.clientTime,
        serverTime: Date.now(),
        serverTick: this.state.tick,
      });
    });

    this.setFixedTimestep((context) => this.updateRace(context.dtMs), SERVER_TICK_RATE);
  }

  override onJoin(client: Client, rawOptions: RaceRoomOptions): void {
    const options = parseRaceRoomOptions(rawOptions);
    if (options.protocolVersion !== PROTOCOL_VERSION) {
      client.send(SERVER_MESSAGE.protocolError, {
        code: "PROTOCOL_MISMATCH",
        message: `Se requiere la versión ${PROTOCOL_VERSION} del protocolo.`,
      } satisfies ProtocolErrorMessage);
      client.leave(4000, "Protocol mismatch");
      return;
    }

    const slot = this.state.players.size;
    const fallbackColor = PLAYER_COLORS[slot] ?? PLAYER_COLORS[0];
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.displayName = sanitizeDisplayName(options.displayName);
    player.bikeColor = sanitizeBikeColor(options.bikeColor, fallbackColor);
    player.slot = slot;
    player.lateralPosition = PLAYER_STARTS[slot] ?? 0;
    this.state.players.set(client.sessionId, player);

    client.send(SERVER_MESSAGE.roomInfo, {
      roomId: this.roomId,
      inviteCode: this.roomId,
      sessionId: client.sessionId,
      protocolVersion: PROTOCOL_VERSION,
      tickRate: SERVER_TICK_RATE,
    } satisfies RoomInfoMessage);
  }

  override async onDrop(client: Client): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;

    try {
      await this.allowReconnection(client, 10);
      player.connected = true;
    } catch {
      this.removePlayer(client.sessionId);
    }
  }

  override onLeave(client: Client): void {
    this.removePlayer(client.sessionId);
  }

  private updateRace(deltaMs: number): void {
    this.state.tick += 1;

    if (this.state.phase === "countdown") {
      this.state.countdownMs = Math.max(0, this.state.countdownMs - deltaMs);
      if (this.state.countdownMs === 0) {
        this.state.phase = "racing";
        this.broadcast(SERVER_MESSAGE.raceEvent, {
          type: "started",
          serverTick: this.state.tick,
        } satisfies RaceEventMessage);
      }
      return;
    }

    if (this.state.phase !== "racing") return;
    this.state.elapsedMs += deltaMs;
    const deltaSeconds = deltaMs / 1_000;

    for (const [sessionId, player] of this.state.players) {
      if (player.finished) continue;
      advancePlayer(
        player,
        this.pendingInputs.get(sessionId) ?? idleInput(this.state.tick),
        deltaSeconds,
      );
      if (player.distance >= RACE_DISTANCE_METERS) this.finishRace(player);
    }
  }

  private tryStartCountdown(): void {
    if (this.state.players.size !== MAX_PLAYERS) return;
    if (![...this.state.players.values()].every((player) => player.ready && player.connected))
      return;
    this.state.phase = "countdown";
    this.state.countdownMs = COUNTDOWN_MS;
    void this.lock();
    this.broadcast(SERVER_MESSAGE.raceEvent, {
      type: "countdown",
      startsInMs: COUNTDOWN_MS,
    } satisfies RaceEventMessage);
  }

  private finishRace(player: PlayerState): void {
    player.finished = true;
    player.finishTimeMs = this.state.elapsedMs;
    this.state.winnerSessionId = player.sessionId;
    this.state.phase = "finished";
    this.broadcast(SERVER_MESSAGE.raceEvent, {
      type: "finished",
      winnerSessionId: player.sessionId,
      elapsedMs: this.state.elapsedMs,
    } satisfies RaceEventMessage);
  }

  private removePlayer(sessionId: string): void {
    if (!this.state.players.has(sessionId)) return;
    this.state.players.delete(sessionId);
    this.pendingInputs.delete(sessionId);
    if (this.state.phase === "waiting") return;
    this.broadcast(SERVER_MESSAGE.raceEvent, {
      type: "opponent-disconnected",
      sessionId,
    } satisfies RaceEventMessage);
  }

  private sendInvalidMessage(client: Client): void {
    client.send(SERVER_MESSAGE.protocolError, {
      code: "INVALID_MESSAGE",
      message: "El servidor rechazó un mensaje con formato inválido.",
    } satisfies ProtocolErrorMessage);
  }
}
