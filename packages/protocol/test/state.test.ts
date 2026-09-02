import { describe, expect, it } from "vitest";
import { PlayerState, PROTOCOL_VERSION, RaceState } from "../src";

describe("synchronized state", () => {
  it("starts from a safe private-race state", () => {
    const state = new RaceState();
    const player = new PlayerState();
    player.sessionId = "session-1";
    state.players.set(player.sessionId, player);

    expect(state.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(state.phase).toBe("waiting");
    expect(state.players.get("session-1")).toBe(player);
  });
});

