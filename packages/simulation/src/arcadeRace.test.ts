import { describe, expect, it } from "vitest";
import {
  ARCADE_COUNTDOWN_MS,
  ARCADE_RACE_DISTANCE_METERS,
  ARCADE_TICK_MS,
  advancePlayer,
  createHostRaceLoop,
  createHostSnapshot,
  createRoomCode,
  ensureHostPlayer,
  idleInput,
  queueHostInput,
  startHostCountdown,
  stepHostRace,
} from "./index";

const THROTTLE = { tick: 1, throttle: 1, brake: 0, steering: 0, boost: false };

describe("arcade race math", () => {
  it("accelerates and keeps the motorcycle inside the road", () => {
    const player = {
      speed: 0,
      lateralPosition: 0,
      lean: 0,
      distance: 0,
    };
    advancePlayer(player, { tick: 1, throttle: 1, brake: 0, steering: 1, boost: false }, 1);
    expect(player.speed).toBeGreaterThan(0);
    expect(player.lateralPosition).toBe(3.25);
    expect(player.distance).toBeGreaterThan(0);
  });

  it("never advances beyond the finish distance", () => {
    const player = {
      speed: 82,
      lateralPosition: 0,
      lean: 0,
      distance: ARCADE_RACE_DISTANCE_METERS - 1,
    };
    advancePlayer(player, THROTTLE, 1);
    expect(player.distance).toBe(ARCADE_RACE_DISTANCE_METERS);
  });
});

describe("host arcade loop", () => {
  it("starts racing after countdown without moving the bikes", () => {
    const state = createHostRaceLoop("host", "guest");
    startHostCountdown(state);
    queueHostInput(state, "host", THROTTLE);
    queueHostInput(state, "guest", { ...THROTTLE, tick: 2 });

    let ticks = 0;
    const tickLimit = Math.ceil(ARCADE_COUNTDOWN_MS / ARCADE_TICK_MS) + 2;
    while (state.phase === "countdown" && ticks < tickLimit) {
      stepHostRace(state, ARCADE_TICK_MS);
      ticks += 1;
    }

    expect(state.phase).toBe("racing");
    expect(state.countdownMs).toBe(0);
    expect(state.players.get("host")?.distance).toBe(0);
    expect(state.players.get("guest")?.distance).toBe(0);

    stepHostRace(state, ARCADE_TICK_MS);
    expect(state.players.get("host")?.distance).toBeGreaterThan(0);
    expect(state.players.get("guest")?.distance).toBeGreaterThan(0);
  });

  it("finishes when the first of two players reaches the line and then freezes", () => {
    const state = createHostRaceLoop("host", "guest");
    state.phase = "racing";
    const host = state.players.get("host");
    const guest = state.players.get("guest");
    if (!host || !guest) throw new Error("expected two arcade players");

    host.speed = 82;
    host.distance = ARCADE_RACE_DISTANCE_METERS - 1;
    guest.speed = 40;
    guest.distance = 100;
    queueHostInput(state, "host", idleInput(1));
    queueHostInput(state, "guest", idleInput(1));

    stepHostRace(state, 1_000);

    expect(state.phase).toBe("finished");
    expect(state.winnerId).toBe("host");
    expect(host.distance).toBe(ARCADE_RACE_DISTANCE_METERS);
    const frozenGuest = guest.distance;
    expect(frozenGuest).toBeGreaterThan(100);

    queueHostInput(state, "host", { ...THROTTLE, tick: 2 });
    queueHostInput(state, "guest", { ...THROTTLE, tick: 2 });
    for (let tick = 0; tick < 30; tick += 1) {
      stepHostRace(state, ARCADE_TICK_MS);
    }

    expect(host.distance).toBe(ARCADE_RACE_DISTANCE_METERS);
    expect(guest.distance).toBe(frozenGuest);
    expect(createHostSnapshot(state, 7).seq).toBe(7);
    expect(createHostSnapshot(state, 7).players).toHaveLength(2);
  });

  it("builds six-character room codes from the shared alphabet", () => {
    let next = 0;
    const code = createRoomCode((exclusiveMax) => {
      const value = next;
      next = (next + 1) % exclusiveMax;
      return value;
    });
    expect(code).toHaveLength(6);
    expect(code).toBe("ABCDEF");
  });

  it("adds a late guest to the host loop so both bikes share one sim", () => {
    const state = createHostRaceLoop("host");
    expect(state.players.size).toBe(1);
    ensureHostPlayer(state, "guest", 1);
    expect(state.players.size).toBe(2);
    state.phase = "racing";
    queueHostInput(state, "host", THROTTLE);
    queueHostInput(state, "guest", { ...THROTTLE, tick: 2 });
    stepHostRace(state, ARCADE_TICK_MS);
    expect(state.players.get("host")?.distance).toBeGreaterThan(0);
    expect(state.players.get("guest")?.distance).toBeGreaterThan(0);
  });
});
