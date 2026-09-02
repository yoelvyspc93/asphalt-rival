import { describe, expect, it } from "vitest";
import { PlayerState, RACE_DISTANCE_METERS } from "@game-moto/protocol";
import { advancePlayer } from "@game-moto/simulation";

describe("authoritative race math", () => {
  it("accelerates and keeps the motorcycle inside the road", () => {
    const player = new PlayerState();
    advancePlayer(player, { tick: 1, throttle: 1, brake: 0, steering: 1, boost: false }, 1);
    expect(player.speed).toBeGreaterThan(0);
    expect(player.lateralPosition).toBe(3.25);
    expect(player.distance).toBeGreaterThan(0);
  });

  it("never advances beyond the finish distance", () => {
    const player = new PlayerState();
    player.speed = 82;
    player.distance = RACE_DISTANCE_METERS - 1;
    advancePlayer(player, { tick: 1, throttle: 1, brake: 0, steering: 0, boost: false }, 1);
    expect(player.distance).toBe(RACE_DISTANCE_METERS);
  });
});
