import { describe, expect, it } from "vitest";
import { parsePlayerInput, sanitizeBikeColor, sanitizeDisplayName } from "../src";

describe("protocol validation", () => {
  it("normalizes untrusted player input", () => {
    expect(
      parsePlayerInput({ tick: 10.9, throttle: 4, brake: -2, steering: -5, boost: true }),
    ).toEqual({ tick: 10, throttle: 1, brake: 0, steering: -1, boost: true });
  });

  it("rejects malformed input", () => {
    expect(parsePlayerInput({ tick: 1, throttle: "full" })).toBeNull();
  });

  it("sanitizes identity fields", () => {
    expect(sanitizeDisplayName("  Ada\u0000  ")).toBe("Ada");
    expect(sanitizeDisplayName("   ")).toBe("Piloto");
    expect(sanitizeBikeColor("#AABBCC", "#ffffff")).toBe("#aabbcc");
    expect(sanitizeBikeColor("red", "#ffffff")).toBe("#ffffff");
  });
});
