import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  ARCADE_GUEST_INPUT_INTERVAL_MS,
  ARCADE_TICK_MS,
  createHostRaceLoop,
  createRoomCode,
  ensureHostPlayer,
  hostSnapshotPlayers,
  queueHostInput,
  raceInputFromControls,
  startHostCountdown,
  stepHostRace,
  type HostRaceLoopState,
} from "@game-moto/simulation";

import {
  INITIAL_CONNECTION,
  type LobbyPlayer,
  type OnlineRacePhase,
  type RaceConnectionState,
  type RaceInput,
  type RaceNetworkAdapter,
  type RivalSnapshot,
  type SimulationFrame,
} from "./raceNetworkTypes";
import { getSupabaseClient, isSupabaseConfigured, SUPABASE_CONFIG_ERROR } from "./supabaseClient";

const TICK_MS = ARCADE_TICK_MS;
const SNAPSHOT_MS = 50;
const INPUT_INTERVAL_MS = ARCADE_GUEST_INPUT_INTERVAL_MS;
const LOBBY_POLL_MS = 1_000;

type RoomRow = {
  code: string;
  host_id: string;
  phase: OnlineRacePhase;
  seed: number;
  countdown_ms: number;
  elapsed_ms: number;
  winner_id: string | null;
};

type PlayerRow = {
  room_code: string;
  user_id: string;
  display_name: string;
  slot: number;
  ready: boolean;
  connected: boolean;
};

type StateBroadcast = {
  type: "state";
  seq: number;
  phase: OnlineRacePhase;
  countdownMs: number;
  elapsedMs: number;
  winnerId: string;
  players: Array<{
    id: string;
    distance: number;
    lateralPosition: number;
    speed: number;
  }>;
};

type InputBroadcast = {
  type: "input";
  userId: string;
  tick: number;
  throttle: number;
  brake: number;
  steering: number;
  boost: boolean;
};

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

function randomInt(exclusiveMax: number) {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return (array[0] ?? 0) % exclusiveMax;
}

function readableJoinError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/anonymous|signups not allowed|disabled/i.test(message))
    return "El acceso anónimo no está activo en el proyecto de Supabase.";
  if (/ROOM_NOT_FOUND|P0002/i.test(message)) return "No existe una sala con ese código.";
  if (/ROOM_FULL|P0003/i.test(message)) return "La sala ya tiene dos pilotos.";
  if (/RACE_ALREADY_STARTED|P0001/i.test(message)) return "La carrera de esa sala ya comenzó.";
  if (/failed to fetch|network|fetch/i.test(message))
    return "No se pudo contactar con Supabase. Puedes usar la demo local.";
  return message || "No se pudo unir a la sala.";
}

export class SupabaseRaceNetwork implements RaceNetworkAdapter {
  private state: RaceConnectionState = INITIAL_CONNECTION;
  private userId = "";
  private isHost = false;
  private tick = 0;
  private inputTick = 0;
  private snapshotSeq = 0;
  private lastInputSentAt = 0;
  private lastSnapshotSeq = 0;
  private hostLoop: HostRaceLoopState | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private raceChannel: RealtimeChannel | null = null;
  private playersChannel: RealtimeChannel | null = null;
  private roomChannel: RealtimeChannel | null = null;
  private lobbyPoll: ReturnType<typeof setInterval> | null = null;
  private intentionalLeave = false;
  private readonly stateListeners = new Set<(state: RaceConnectionState) => void>();
  private readonly rivalListeners = new Set<(snapshot: RivalSnapshot) => void>();
  private readonly simulationListeners = new Set<(frame: SimulationFrame) => void>();

  get status() {
    return this.state.status;
  }

  async createRoom(displayName: string) {
    if (!this.ensureConfigured()) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    this.resetSession();
    this.update({ status: "conectando", error: "" });

    try {
      const userId = await this.ensureAuth(supabase);
      this.userId = userId;
      this.isHost = true;

      let roomCode = "";
      for (let attempt = 0; attempt < 8; attempt += 1) {
        roomCode = createRoomCode(randomInt);
        const { error } = await supabase.from("rooms").insert({
          code: roomCode,
          host_id: userId,
          seed: randomInt(0xffff_ffff) + 1,
        });
        if (!error) break;
        if (attempt === 7) throw error;
      }

      const { error: playerError } = await supabase.from("room_players").insert({
        room_code: roomCode,
        user_id: userId,
        display_name: normalizeName(displayName),
        slot: 0,
        ready: false,
        connected: true,
      });
      if (playerError) throw playerError;

      await this.attachToRoom(supabase, roomCode, userId, true);
      this.update({
        status: "conectado",
        roomCode,
        sessionId: userId,
        phase: "waiting",
        error: "",
      });
    } catch (error) {
      this.resetSession();
      this.update({ status: "desconectado", error: readableJoinError(error) });
    }
  }

  async joinRoom(roomCode: string, displayName: string) {
    if (!this.ensureConfigured()) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const normalized = normalizeRoomCode(roomCode);
    if (normalized.length !== 6) {
      this.update({ error: "El código de sala debe tener seis caracteres." });
      return;
    }

    this.resetSession();
    this.update({ status: "conectando", error: "" });

    try {
      const userId = await this.ensureAuth(supabase);
      this.userId = userId;
      this.isHost = false;

      const { error } = await supabase.rpc("join_room", {
        p_code: normalized,
        p_display_name: normalizeName(displayName),
      });
      if (error) throw error;

      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .select("host_id")
        .eq("code", normalized)
        .single();
      if (roomError) throw roomError;
      this.isHost = room.host_id === userId;

      await this.attachToRoom(supabase, normalized, userId, this.isHost);
      this.update({
        status: "conectado",
        roomCode: normalized,
        sessionId: userId,
        error: "",
      });
    } catch (error) {
      this.resetSession();
      this.update({ status: "desconectado", error: readableJoinError(error) });
    }
  }

  setReady(ready: boolean) {
    const supabase = getSupabaseClient();
    if (!supabase || !this.state.roomCode || !this.userId) return;
    this.update({
      players: this.state.players.map((player) => (player.local ? { ...player, ready } : player)),
    });
    void supabase
      .from("room_players")
      .update({ ready })
      .eq("room_code", this.state.roomCode)
      .eq("user_id", this.userId)
      .then(() => this.emitLobbySync("ready"));
  }

  sendInput(input: RaceInput) {
    if (this.state.phase !== "racing" && this.state.phase !== "countdown") return;

    if (this.isHost && this.hostLoop) {
      this.inputTick += 1;
      queueHostInput(
        this.hostLoop,
        this.userId,
        raceInputFromControls(this.inputTick, input.throttle, input.brake, input.steer),
      );
      return;
    }

    const now = performance.now();
    if (now - this.lastInputSentAt < INPUT_INTERVAL_MS) return;
    this.lastInputSentAt = now;
    this.tick += 1;

    const payload: InputBroadcast = {
      type: "input",
      userId: this.userId,
      tick: this.tick,
      throttle: input.throttle,
      brake: input.brake,
      steering: input.steer,
      boost: false,
    };
    this.raceChannel?.send({
      type: "broadcast",
      event: "input",
      payload,
    });
  }

  subscribeToRival(listener: (snapshot: RivalSnapshot) => void) {
    this.rivalListeners.add(listener);
    return () => {
      this.rivalListeners.delete(listener);
    };
  }

  subscribeToSimulation(listener: (frame: SimulationFrame) => void) {
    this.simulationListeners.add(listener);
    return () => {
      this.simulationListeners.delete(listener);
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
    void this.markDisconnected();
    this.resetSession();
    this.state = INITIAL_CONNECTION;
    this.emitState();
  }

  private ensureConfigured() {
    if (isSupabaseConfigured()) return true;
    this.update({ status: "desconectado", error: SUPABASE_CONFIG_ERROR });
    return false;
  }

  private async ensureAuth(supabase: NonNullable<ReturnType<typeof getSupabaseClient>>) {
    const existing = await supabase.auth.getSession();
    const token = existing.data.session?.access_token;
    if (existing.data.session?.user.id && token) {
      await supabase.realtime.setAuth(token);
      return existing.data.session.user.id;
    }

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) throw error ?? new Error("No se pudo iniciar sesión anónima.");
    if (data.session?.access_token) await supabase.realtime.setAuth(data.session.access_token);
    return data.user.id;
  }

  private async attachToRoom(
    supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
    roomCode: string,
    userId: string,
    isHost: boolean,
  ) {
    await this.loadLobby(supabase, roomCode, userId);
    this.startLobbyPoll(supabase, roomCode, userId);

    this.roomChannel = supabase
      .channel(`room:${roomCode}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `code=eq.${roomCode}` },
        (payload) => {
          const row = payload.new as RoomRow;
          if (!row?.phase) return;
          this.applyRoomRow(row);
        },
      );
    this.roomChannel.subscribe(() => {
      void this.loadLobby(supabase, roomCode, userId);
    });

    this.playersChannel = supabase
      .channel(`players:${roomCode}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_players", filter: `room_code=eq.${roomCode}` },
        () => {
          void this.loadLobby(supabase, roomCode, userId);
        },
      );
    this.playersChannel.subscribe(() => {
      void this.loadLobby(supabase, roomCode, userId);
    });

    this.raceChannel = supabase
      .channel(`race:${roomCode}`, {
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: userId },
        },
      })
      .on("broadcast", { event: "input" }, ({ payload }) => {
        if (!this.isHost || !this.hostLoop) return;
        const message = payload as InputBroadcast;
        if (message.userId === this.userId) return;
        queueHostInput(this.hostLoop, message.userId, {
          tick: message.tick,
          throttle: message.throttle,
          brake: message.brake,
          steering: message.steering,
          boost: message.boost,
        });
      })
      .on("broadcast", { event: "state" }, ({ payload }) => {
        if (this.isHost) return;
        this.consumeSnapshot(payload as StateBroadcast);
      })
      .on("broadcast", { event: "lobby" }, () => {
        void this.loadLobby(supabase, roomCode, userId);
      })
      .on("presence", { event: "sync" }, () => {
        void this.loadLobby(supabase, roomCode, userId);
      })
      .on("presence", { event: "join" }, () => {
        void this.loadLobby(supabase, roomCode, userId);
      })
      .on("presence", { event: "leave" }, ({ leftPresences }) => {
        const opponentLeft = leftPresences.some((entry) => {
          const tracked = entry as { userId?: string };
          return tracked.userId !== undefined && tracked.userId !== this.userId;
        });
        if (opponentLeft) this.handleOpponentLeft();
      });

    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(() => resolve(), 4_000);
      this.raceChannel?.subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        window.clearTimeout(timeout);
        void this.raceChannel?.track({ userId });
        void this.loadLobby(supabase, roomCode, userId);
        if (!isHost) this.emitLobbySync("join");
        resolve();
      });
    });

    if (isHost) {
      this.hostLoop = createHostRaceLoop(userId);
      this.startHostTimers(supabase, roomCode);
      void this.requestWakeLock();
    }

    window.addEventListener("beforeunload", this.handleBeforeUnload);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  private emitLobbySync(reason: "join" | "ready") {
    void this.raceChannel?.send({
      type: "broadcast",
      event: "lobby",
      payload: { reason, userId: this.userId },
    });
  }

  private startLobbyPoll(
    supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
    roomCode: string,
    userId: string,
  ) {
    this.stopLobbyPoll();
    this.lobbyPoll = setInterval(() => {
      if (this.state.phase !== "waiting") {
        this.stopLobbyPoll();
        return;
      }
      void this.loadLobby(supabase, roomCode, userId);
    }, LOBBY_POLL_MS);
  }

  private stopLobbyPoll() {
    if (this.lobbyPoll) clearInterval(this.lobbyPoll);
    this.lobbyPoll = null;
  }

  private handleVisibility = () => {
    if (document.visibilityState === "visible" && this.isHost) void this.requestWakeLock();
  };

  private handleOpponentLeft() {
    if (this.state.phase === "waiting") {
      this.update({
        players: this.state.players.map((player) =>
          player.local ? player : { ...player, connected: false },
        ),
      });
      return;
    }
    if (this.hostLoop && this.hostLoop.phase !== "finished") this.hostLoop.phase = "finished";
    this.update({
      error: "El rival se desconectó de la carrera.",
      phase: "finished",
    });
  }

  private handleBeforeUnload = () => {
    void this.markDisconnected(true);
  };

  private async loadLobby(
    supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
    roomCode: string,
    userId: string,
  ) {
    const [{ data: room, error: roomError }, { data: players, error: playersError }] =
      await Promise.all([
        supabase.from("rooms").select("*").eq("code", roomCode).single(),
        supabase
          .from("room_players")
          .select("*")
          .eq("room_code", roomCode)
          .order("slot", { ascending: true }),
      ]);

    if (roomError || playersError || !room || !players) return;

    if (this.isHost && this.hostLoop) {
      for (const player of players as PlayerRow[]) {
        ensureHostPlayer(this.hostLoop, player.user_id, player.slot);
      }
    }

    const lobbyPlayers: LobbyPlayer[] = players.map((player: PlayerRow) => ({
      sessionId: player.user_id,
      displayName: player.display_name,
      ready: player.ready,
      connected: player.connected,
      local: player.user_id === userId,
    }));

    this.update({
      players: lobbyPlayers,
      phase: room.phase,
      countdownMs: room.countdown_ms,
      elapsedMs: room.elapsed_ms,
      winnerSessionId: room.winner_id ?? "",
      seed: room.seed || this.state.seed,
    });

    if (room.phase !== "waiting") return;
    if (!this.isHost) return;
    if (players.length !== 2) return;
    if (!players.every((player: PlayerRow) => player.ready && player.connected)) return;

    await supabase
      .from("rooms")
      .update({ phase: "countdown", countdown_ms: 3_000 })
      .eq("code", roomCode);

    if (this.hostLoop) {
      startHostCountdown(this.hostLoop);
    }
  }

  private applyRoomRow(row: RoomRow) {
    this.update({
      phase: row.phase,
      countdownMs: row.countdown_ms,
      elapsedMs: row.elapsed_ms,
      winnerSessionId: row.winner_id ?? "",
      seed: row.seed || this.state.seed,
    });

    if (row.phase === "countdown" && this.isHost && this.hostLoop?.phase === "waiting") {
      startHostCountdown(this.hostLoop);
    }

    if (row.phase === "finished" && !this.isHost) {
      this.stopHostTimers();
    }
  }

  private startHostTimers(
    supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
    roomCode: string,
  ) {
    this.stopHostTimers();
    let lastSnapshotAt = 0;

    this.tickTimer = setInterval(() => {
      if (!this.hostLoop) return;

      const phaseBefore = this.hostLoop.phase;
      stepHostRace(this.hostLoop, TICK_MS);
      const loop = this.hostLoop;

      this.update({
        phase: loop.phase,
        countdownMs: loop.countdownMs,
        elapsedMs: loop.elapsedMs,
        winnerSessionId: loop.winnerId,
      });

      this.emitSimulationFromLoop(loop);

      const now = performance.now();
      if (now - lastSnapshotAt >= SNAPSHOT_MS) {
        lastSnapshotAt = now;
        this.snapshotSeq += 1;
        const payload: StateBroadcast = {
          type: "state",
          seq: this.snapshotSeq,
          phase: loop.phase,
          countdownMs: loop.countdownMs,
          elapsedMs: loop.elapsedMs,
          winnerId: loop.winnerId,
          players: hostSnapshotPlayers(loop),
        };
        this.raceChannel?.send({ type: "broadcast", event: "state", payload });
      }

      if (loop.phase === "racing" && phaseBefore === "countdown") {
        void supabase.from("rooms").update({ phase: "racing" }).eq("code", roomCode);
        void this.requestWakeLock();
      }

      if (loop.phase === "finished" && phaseBefore !== "finished") {
        void supabase
          .from("rooms")
          .update({
            phase: "finished",
            winner_id: loop.winnerId,
            elapsed_ms: loop.elapsedMs,
          })
          .eq("code", roomCode);
        void this.releaseWakeLock();
      }
    }, TICK_MS);
  }

  private stopHostTimers() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    void this.releaseWakeLock();
  }

  private consumeSnapshot(snapshot: StateBroadcast) {
    if (snapshot.seq <= this.lastSnapshotSeq) return;
    this.lastSnapshotSeq = snapshot.seq;
    this.update({
      phase: snapshot.phase,
      countdownMs: snapshot.countdownMs,
      elapsedMs: snapshot.elapsedMs,
      winnerSessionId: snapshot.winnerId,
    });
    this.emitSimulationFromPlayers(snapshot.players, snapshot.elapsedMs);
  }

  private emitSimulationFromLoop(loop: HostRaceLoopState) {
    this.emitSimulationFromPlayers(hostSnapshotPlayers(loop), loop.elapsedMs);
  }

  private emitSimulationFromPlayers(
    players: Array<{ id: string; distance: number; lateralPosition: number; speed: number }>,
    elapsedMs: number,
  ) {
    const local = players.find((player) => player.id === this.userId);
    const rival = players.find((player) => player.id !== this.userId);
    const frame: SimulationFrame = {
      local: local ? this.toRiderFrame(local) : null,
      rival: rival ? this.toRiderFrame(rival) : null,
      elapsedMs,
      seed: this.state.seed || 42,
    };
    this.simulationListeners.forEach((listener) => listener(frame));
    if (!rival) return;
    const snapshot: RivalSnapshot = {
      ...frame.rival!,
      timestamp: performance.now(),
    };
    this.rivalListeners.forEach((listener) => listener(snapshot));
  }

  private toRiderFrame(player: { distance: number; lateralPosition: number; speed: number }) {
    return {
      distance: player.distance,
      laneOffset: player.lateralPosition,
      speed: player.speed * 3.6,
    };
  }

  private async requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      // Wake Lock is best-effort on mobile browsers.
    }
  }

  private async releaseWakeLock() {
    if (!this.wakeLock) return;
    try {
      await this.wakeLock.release();
    } catch {
      // Ignore release errors.
    }
    this.wakeLock = null;
  }

  private async markDisconnected(sync = false) {
    const supabase = getSupabaseClient();
    if (!supabase || !this.state.roomCode || !this.userId) return;

    const update = supabase
      .from("room_players")
      .update({ connected: false, ready: false })
      .eq("room_code", this.state.roomCode)
      .eq("user_id", this.userId);

    if (sync && "keepalive" in Request.prototype) {
      await update;
      return;
    }
    await update;
  }

  private resetSession() {
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.stopHostTimers();
    this.stopLobbyPoll();

    const supabase = getSupabaseClient();
    if (supabase) {
      if (this.raceChannel) void supabase.removeChannel(this.raceChannel);
      if (this.playersChannel) void supabase.removeChannel(this.playersChannel);
      if (this.roomChannel) void supabase.removeChannel(this.roomChannel);
    }

    this.raceChannel = null;
    this.playersChannel = null;
    this.roomChannel = null;
    this.hostLoop = null;
    this.userId = "";
    this.isHost = false;
    this.tick = 0;
    this.inputTick = 0;
    this.snapshotSeq = 0;
    this.lastSnapshotSeq = 0;
    this.intentionalLeave = false;
  }

  private update(patch: Partial<RaceConnectionState>) {
    const disconnectedOpponent =
      patch.players?.some((player) => !player.local && !player.connected) &&
      this.state.phase !== "waiting" &&
      this.state.phase !== "finished";

    this.state = {
      ...this.state,
      ...patch,
      error:
        patch.error ??
        (disconnectedOpponent && !this.intentionalLeave
          ? "El rival se desconectó de la carrera."
          : this.state.error),
    };
    this.emitState();
  }

  private emitState() {
    this.stateListeners.forEach((listener) => listener(this.state));
  }
}
