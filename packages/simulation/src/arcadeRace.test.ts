import { describe, expect, it } from "vitest";
import {
  ARCADE_COUNTDOWN_MS,
  ARCADE_RACE_DISTANCE_METERS,
  ARCADE_TICK_MS,
  advancePlayer,
  arcadeTrafficOverlaps,
  arcadeTrafficLateralPosition,
  applyArcadeTrafficCollisions,
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
  it("does not collide with traffic metres before visible contact", () => {
    const car = {
      id: "contact",
      kind: "car" as const,
      laneIndex: 1,
      lateralPosition: -1.75,
      distance: 200,
      speed: 0,
      width: 1.85,
      length: 4.4,
    };
    expect(arcadeTrafficOverlaps({ distance: 194, lateralPosition: -1.55 }, car, 0)).toBe(false);
    expect(arcadeTrafficOverlaps({ distance: 196.5, lateralPosition: -1.55 }, car, 0)).toBe(false);
    expect(arcadeTrafficOverlaps({ distance: 196.8, lateralPosition: -1.55 }, car, 0)).toBe(true);
    expect(arcadeTrafficOverlaps({ distance: 200, lateralPosition: -0.1 }, car, 0)).toBe(false);
    expect(arcadeTrafficOverlaps({ distance: 200, lateralPosition: -0.3 }, car, 0)).toBe(true);
  });

  it("accelerates and keeps the motorcycle inside the road", () => {
    const player = {
      speed: 0,
      lateralPosition: 0,
      lean: 0,
      distance: 0,
    };
    advancePlayer(player, { tick: 1, throttle: 1, brake: 0, steering: 1, boost: false }, 2);
    expect(player.speed).toBeGreaterThan(0);
    expect(player.lateralPosition).toBe(5.55);
    expect(player.distance).toBeGreaterThan(0);
  });

  it("applies strong brakes and ignores throttle while braking", () => {
    const withThrottle = { speed: 300 / 3.6, lateralPosition: 0, lean: 0, distance: 0 };
    const withoutThrottle = { ...withThrottle };
    const brakeWithThrottle = { tick: 1, throttle: 1, brake: 1, steering: 0, boost: true };
    const brakeOnly = { ...brakeWithThrottle, throttle: 0, boost: false };

    for (let tick = 0; tick < 90; tick += 1) {
      advancePlayer(withThrottle, brakeWithThrottle, 1 / 60);
      advancePlayer(withoutThrottle, brakeOnly, 1 / 60);
    }

    expect(withThrottle.speed).toBe(0);
    expect(withThrottle.distance).toBeLessThan(60);
    expect(withThrottle).toEqual(withoutThrottle);
  });

  it("projects deterministic lane drift into collision coordinates", () => {
    const car = {
      id: "divider-closer",
      kind: "car" as const,
      laneIndex: 1,
      lateralPosition: -1.2,
      distance: 200,
      speed: 0,
      width: 1.85,
      length: 4.4,
    };

    expect(arcadeTrafficLateralPosition(car)).toBeCloseTo(-1, 12);
    expect(arcadeTrafficOverlaps({ distance: 200, lateralPosition: 0 }, car, 0)).toBe(true);
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

  it("slows a rider that overlaps a traffic car", () => {
    const player = {
      speed: 70,
      lateralPosition: -1.55,
      lean: 0,
      distance: 200,
      hitstunMs: 0,
    };
    const car = {
      id: "traffic-hit",
      kind: "car" as const,
      laneIndex: 1,
      lateralPosition: -1.75,
      distance: 200,
      speed: 22,
      width: 1.85,
      length: 4.4,
    };
    const cooldowns = new Map<string, number>();

    const hit = applyArcadeTrafficCollisions(player, [car], 0, cooldowns, 0, "host");

    expect(hit?.trafficId).toBe("traffic-hit");
    expect(player.speed).toBeLessThan(10);
    expect(player.distance).toBeLessThan(200);
    expect(player.hitstunMs).toBeGreaterThan(0);

    const speedAfterHit = player.speed;
    const blockedDistance = player.distance;
    const secondHit = applyArcadeTrafficCollisions(player, [car], 0, cooldowns, 10, "host");
    expect(secondHit).toBeNull();
    expect(player.speed).toBeLessThanOrEqual(speedAfterHit);
    expect(player.distance).toBeLessThanOrEqual(blockedDistance);
  });

  it("keeps a fast rider from tunneling through a parked car", () => {
    const player = {
      speed: 80,
      lateralPosition: -1.55,
      lean: 0,
      distance: 199,
    };
    const car = {
      id: "parked",
      kind: "car" as const,
      laneIndex: 1,
      lateralPosition: -1.75,
      distance: 200,
      speed: 0,
      width: 1.85,
      length: 4.4,
    };

    applyArcadeTrafficCollisions(player, [car], 0, new Map(), 0, "host");

    expect(player.distance).toBeLessThanOrEqual(200 - 2.2 - 1.1);
    expect(player.speed).toBeLessThan(9);
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
