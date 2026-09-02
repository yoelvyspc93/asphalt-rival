import { describe, expect, it } from "vitest";

import {
  BIKE_WIDTH_METERS,
  FIXED_TIME_STEP_SECONDS,
  HARD_COLLISION_SPEED_METERS_PER_SECOND,
  MAX_SPEED_METERS_PER_SECOND,
  RESPAWN_IMMUNITY_TICKS,
  RESPAWN_TICKS,
  ROAD_HALF_WIDTH_METERS,
  TICK_RATE,
  TRACK_LENGTH_METERS,
  RaceSimulation,
  cloneSimulationState,
  createSimulationState,
  generateTraffic,
  normalizeInput,
  stepSimulation,
  type SimulationEvent,
  type SimulationState,
  type TrafficVehicleState,
} from "./index";

function trafficAt(
  distance: number,
  lateralPosition = 0,
  speed = 0,
): TrafficVehicleState {
  return {
    id: "obstacle",
    kind: "car",
    laneIndex: 1,
    lateralPosition,
    distance,
    speed,
    width: 1.85,
    length: 4.4,
  };
}

function emptyRace(playerIds: readonly string[] = ["rider-a"]): SimulationState {
  return createSimulationState(playerIds, 42, { trafficDensityPerLaneKm: 0 });
}

type CollisionEvent = Extract<SimulationEvent, { type: "collision" }>;

function collisionEvent(events: readonly SimulationEvent[]): CollisionEvent | undefined {
  return events.find((event): event is CollisionEvent => event.type === "collision");
}

describe("canonical constants and input boundary", () => {
  it("uses a fixed 60 Hz step and a five-kilometre course", () => {
    expect(TICK_RATE).toBe(60);
    expect(FIXED_TIME_STEP_SECONDS).toBe(1 / 60);
    expect(TRACK_LENGTH_METERS).toBe(5_000);
    expect(RESPAWN_TICKS).toBe(120);
    expect(RESPAWN_IMMUNITY_TICKS).toBe(90);
  });

  it("clamps controls and converts non-finite or absent values to neutral", () => {
    expect(normalizeInput({ throttle: 2, brake: -1, steer: -4 })).toEqual({
      throttle: 1,
      brake: 0,
      steer: -1,
    });
    expect(normalizeInput({ throttle: Number.NaN, brake: Infinity, steer: -Infinity })).toEqual({
      throttle: 0,
      brake: 0,
      steer: 0,
    });
    expect(normalizeInput(undefined)).toEqual({ throttle: 0, brake: 0, steer: 0 });
  });

  it("accepts one or two unique players and rejects invalid rooms", () => {
    expect(createSimulationState(["solo"], 1).players).toHaveLength(1);
    expect(createSimulationState(["one", "two"], 1).players).toHaveLength(2);
    expect(() => createSimulationState([], 1)).toThrow(RangeError);
    expect(() => createSimulationState(["a", "b", "c"], 1)).toThrow(RangeError);
    expect(() => createSimulationState(["a", "a"], 1)).toThrow(/unique/);
    expect(() => createSimulationState(["  "], 1)).toThrow(/non-empty/);
  });
});

describe("seeded traffic", () => {
  it("is identical for the same seed and changes for a different seed", () => {
    expect(generateTraffic(734)).toEqual(generateTraffic(734));
    expect(generateTraffic(734)).not.toEqual(generateTraffic(735));
  });

  it("generates bounded stable vehicles and supports an empty field", () => {
    const traffic = generateTraffic(8);
    expect(traffic).toHaveLength(4 * 5 * 14);
    expect(new Set(traffic.map((vehicle) => vehicle.id)).size).toBe(traffic.length);
    expect(traffic.every((vehicle) => vehicle.distance >= 120)).toBe(true);
    expect(traffic.every((vehicle) => vehicle.distance < TRACK_LENGTH_METERS)).toBe(true);
    expect(generateTraffic(8, 0)).toEqual([]);
  });

  it("moves traffic exactly once per fixed tick", () => {
    const state = emptyRace();
    state.traffic = [trafficAt(100, 3, 30)];
    stepSimulation(state);
    expect(state.traffic[0]!.distance).toBeCloseTo(100.5, 12);
  });
});

describe("arcade motorcycle integration", () => {
  it("accelerates, brakes and never exceeds the speed cap", () => {
    const state = emptyRace();
    for (let tick = 0; tick < 20 * TICK_RATE; tick += 1) {
      stepSimulation(state, { "rider-a": { throttle: 1, brake: 0, steer: 0 } });
    }
    const acceleratedSpeed = state.players[0]!.longitudinalSpeed;
    expect(acceleratedSpeed).toBeGreaterThan(50);
    expect(acceleratedSpeed).toBeLessThanOrEqual(MAX_SPEED_METERS_PER_SECOND);

    for (let tick = 0; tick < 3 * TICK_RATE; tick += 1) {
      stepSimulation(state, { "rider-a": { throttle: 0, brake: 1, steer: 0 } });
    }
    expect(state.players[0]!.longitudinalSpeed).toBe(0);
  });

  it("steers progressively, recentres and remains within the road", () => {
    const state = emptyRace();
    const rider = state.players[0]!;
    rider.longitudinalSpeed = 35;
    for (let tick = 0; tick < TICK_RATE; tick += 1) {
      stepSimulation(state, { "rider-a": { throttle: 0, brake: 0, steer: 1 } });
    }
    expect(rider.lateralPosition).toBeGreaterThan(1);
    expect(rider.lateralSpeed).toBeGreaterThan(0);
    expect(rider.headingRadians).toBeGreaterThan(0);

    rider.lateralPosition = ROAD_HALF_WIDTH_METERS;
    stepSimulation(state, { "rider-a": { throttle: 0, brake: 0, steer: 1 } });
    expect(rider.lateralPosition).toBe(ROAD_HALF_WIDTH_METERS - BIKE_WIDTH_METERS / 2);
    expect(rider.lateralSpeed).toBeLessThanOrEqual(0);
  });

  it("produces the same state for the same seed and input stream", () => {
    const first = new RaceSimulation(["a", "b"], 19, { trafficDensityPerLaneKm: 0 });
    const second = new RaceSimulation(["a", "b"], 19, { trafficDensityPerLaneKm: 0 });
    for (let tick = 0; tick < 600; tick += 1) {
      const controls = {
        a: { throttle: 1, brake: tick > 500 ? 0.25 : 0, steer: Math.sin(tick / 40) },
        b: { throttle: 0.8, brake: 0, steer: Math.cos(tick / 35) * 0.7 },
      };
      first.step(controls);
      second.step(controls);
    }
    expect(first.state).toEqual(second.state);
  });

  it("returns an independent serializable snapshot", () => {
    const simulation = new RaceSimulation(["a"], 5, { trafficDensityPerLaneKm: 0 });
    simulation.step({ a: { throttle: 1, brake: 0, steer: 0 } });
    const snapshot = simulation.snapshot();
    expect(snapshot).toEqual(simulation.state);
    snapshot.players[0]!.distance = 999;
    expect(simulation.state.players[0]!.distance).not.toBe(999);
    expect(cloneSimulationState(simulation.state)).toEqual(simulation.state);
  });
});

describe("continuous collisions", () => {
  it("applies a soft response below 12 m/s without knocking the rider down", () => {
    const state = emptyRace();
    const rider = state.players[0]!;
    rider.longitudinalSpeed = HARD_COLLISION_SPEED_METERS_PER_SECOND - 0.01;
    state.traffic = [trafficAt(0)];

    const { events } = stepSimulation(state);
    expect(collisionEvent(events)).toMatchObject({ severity: "soft", targetType: "traffic" });
    expect(rider.status).toBe("racing");
    expect(rider.longitudinalSpeed).toBeLessThan(12);
  });

  it("treats an impact at exactly 12 m/s as hard", () => {
    const state = emptyRace();
    const rider = state.players[0]!;
    rider.longitudinalSpeed = 20;
    const nextRiderSpeed = 20 - (0.18 + 0.0022 * 20 ** 2) * FIXED_TIME_STEP_SECONDS;
    state.traffic = [trafficAt(0, 0, nextRiderSpeed - HARD_COLLISION_SPEED_METERS_PER_SECOND)];

    const { events } = stepSimulation(state);
    expect(collisionEvent(events)).toMatchObject({ severity: "hard" });
    expect(collisionEvent(events)!.impactSpeed).toBeCloseTo(12, 12);
    expect(rider.status).toBe("knockedDown");
    expect(rider.respawnTicksRemaining).toBe(RESPAWN_TICKS);
  });

  it("uses swept collision detection so a fast rider cannot tunnel through traffic", () => {
    const state = emptyRace();
    const rider = state.players[0]!;
    rider.longitudinalSpeed = MAX_SPEED_METERS_PER_SECOND;
    state.traffic = [trafficAt(0.75)];
    const { events } = stepSimulation(state);
    expect(collisionEvent(events)).toMatchObject({ severity: "hard", targetId: "obstacle" });
  });

  it("resolves player contacts softly below the threshold and hard above it", () => {
    const soft = emptyRace(["a", "b"]);
    soft.players[0]!.lateralPosition = 0;
    soft.players[1]!.lateralPosition = 0;
    soft.players[0]!.longitudinalSpeed = 15;
    soft.players[1]!.longitudinalSpeed = 10;
    const softEvents = stepSimulation(soft).events;
    expect(collisionEvent(softEvents)).toMatchObject({ severity: "soft", targetType: "player" });
    expect(soft.players.every((player) => player.status === "racing")).toBe(true);

    const hard = emptyRace(["a", "b"]);
    hard.players[0]!.lateralPosition = 0;
    hard.players[1]!.lateralPosition = 0;
    hard.players[0]!.longitudinalSpeed = 30;
    hard.players[1]!.longitudinalSpeed = 5;
    const hardEvents = stepSimulation(hard).events;
    expect(collisionEvent(hardEvents)).toMatchObject({ severity: "hard", targetType: "player" });
    expect(hard.players.every((player) => player.status === "knockedDown")).toBe(true);
  });

  it("does not emit the same soft overlap on every tick", () => {
    const state = emptyRace();
    state.players[0]!.longitudinalSpeed = 5;
    state.traffic = [trafficAt(0, 0, 0)];
    expect(collisionEvent(stepSimulation(state).events)).toBeDefined();
    expect(collisionEvent(stepSimulation(state).events)).toBeUndefined();
  });
});

describe("knockdown recovery", () => {
  it("respawns after exactly two seconds with 1.5 seconds of immunity", () => {
    const state = emptyRace();
    const rider = state.players[0]!;
    rider.longitudinalSpeed = 40;
    state.traffic = [trafficAt(0)];
    stepSimulation(state);
    expect(rider.status).toBe("knockedDown");

    for (let tick = 0; tick < RESPAWN_TICKS - 1; tick += 1) stepSimulation(state);
    expect(rider.status).toBe("knockedDown");
    expect(rider.respawnTicksRemaining).toBe(1);

    const respawnEvents = stepSimulation(state).events;
    expect(respawnEvents).toContainEqual(
      expect.objectContaining({ type: "respawn", playerId: "rider-a" }),
    );
    expect(rider.status).toBe("racing");
    expect(rider.immunityTicksRemaining).toBe(RESPAWN_IMMUNITY_TICKS);

    state.traffic = [trafficAt(rider.distance, rider.lateralPosition, 0)];
    for (let tick = 0; tick < RESPAWN_IMMUNITY_TICKS; tick += 1) {
      expect(collisionEvent(stepSimulation(state).events)).toBeUndefined();
    }
    expect(rider.immunityTicksRemaining).toBe(0);
  });
});

describe("race result", () => {
  it("selects the earliest sub-tick crossing and ranks the other rider by distance", () => {
    const state = emptyRace(["late", "winner"]);
    state.players[0]!.distance = TRACK_LENGTH_METERS - 0.8;
    state.players[0]!.longitudinalSpeed = 60;
    state.players[1]!.distance = TRACK_LENGTH_METERS - 0.4;
    state.players[1]!.longitudinalSpeed = 60;

    const { events } = stepSimulation(state);
    expect(state.result?.winnerIds).toEqual(["winner"]);
    expect(state.result?.rankings.map((ranking) => ranking.playerId)).toEqual(["winner", "late"]);
    expect(events.at(-1)).toMatchObject({ type: "raceFinished" });
  });

  it("declares a true same-time crossing a shared first place", () => {
    const state = emptyRace(["b", "a"]);
    for (const player of state.players) {
      player.distance = TRACK_LENGTH_METERS - 0.5;
      player.longitudinalSpeed = 60;
    }
    stepSimulation(state);
    expect(state.result?.winnerIds).toEqual(["a", "b"]);
    expect(state.result?.rankings.map((ranking) => ranking.position)).toEqual([1, 1]);
  });

  it("freezes the authoritative race once a result exists", () => {
    const state = emptyRace();
    state.players[0]!.distance = TRACK_LENGTH_METERS - 0.1;
    state.players[0]!.longitudinalSpeed = 30;
    stepSimulation(state);
    const completedTick = state.tick;
    const completedDistance = state.players[0]!.distance;
    const next = stepSimulation(state, { "rider-a": { throttle: 1, brake: 0, steer: 1 } });
    expect(next.events).toEqual([]);
    expect(state.tick).toBe(completedTick);
    expect(state.players[0]!.distance).toBe(completedDistance);
  });
});
