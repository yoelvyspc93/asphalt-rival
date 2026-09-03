import {
  DEFAULT_TRAFFIC_DENSITY_PER_LANE_KM,
  LANE_CENTERS_METERS,
  TRACK_LENGTH_METERS,
} from "./constants";
import { SeededRandom, normalizeSeed } from "./random";
import type { TrafficKind, TrafficVehicleState } from "./types";

const TRAFFIC_DIMENSIONS: Record<TrafficKind, { width: number; length: number }> = {
  car: { width: 1.85, length: 4.4 },
  van: { width: 2.05, length: 5.2 },
  truck: { width: 2.45, length: 8.5 },
};

/** Creates a complete, stable traffic field for the five-kilometre race. */
export function generateTraffic(
  seed: number,
  densityPerLaneKm = DEFAULT_TRAFFIC_DENSITY_PER_LANE_KM,
): TrafficVehicleState[] {
  const random = new SeededRandom(normalizeSeed(seed));
  const safeDensity = Number.isFinite(densityPerLaneKm)
    ? Math.max(0, Math.min(40, densityPerLaneKm))
    : DEFAULT_TRAFFIC_DENSITY_PER_LANE_KM;
  const targetPerLane = Math.round((TRACK_LENGTH_METERS / 1_000) * safeDensity);
  const traffic: TrafficVehicleState[] = [];

  for (let laneIndex = 0; laneIndex < LANE_CENTERS_METERS.length; laneIndex += 1) {
    const nominalGap = targetPerLane > 0 ? (TRACK_LENGTH_METERS - 120) / targetPerLane : 0;

    for (let index = 0; index < targetPerLane; index += 1) {
      const progress = 120 + nominalGap * (index + random.between(0.15, 0.85));
      const kindRoll = random.next();
      // Initial roster: one sedan and one van, with cosmetic colour variants in the renderer.
      const kind: TrafficKind = kindRoll < 0.7 ? "car" : "van";
      const dimensions = TRAFFIC_DIMENSIONS[kind];
      const lateralPosition = createTrafficLateralPosition(random, laneIndex);

      traffic.push({
        id: `traffic-${laneIndex}-${index}`,
        kind,
        laneIndex,
        lateralPosition,
        distance: Math.min(progress, TRACK_LENGTH_METERS - 15),
        speed: random.between(22, kind === "car" ? 38 : 32),
        width: dimensions.width,
        length: dimensions.length,
      });
    }
  }

  return traffic.sort(
    (left, right) => left.distance - right.distance || left.id.localeCompare(right.id),
  );
}

/**
 * Adds restrained, deterministic lane drift so the painted centre divider is
 * not a permanent collision-free racing line. Inner-lane vehicles occasionally
 * run closer to the divider while always remaining inside their own lane.
 */
function createTrafficLateralPosition(random: SeededRandom, laneIndex: number): number {
  const laneCenter = LANE_CENTERS_METERS[laneIndex]!;
  const isInnerLane = laneIndex === 1 || laneIndex === 2;

  if (isInnerLane && random.next() < 0.38) {
    const towardCenter = laneIndex === 1 ? 1 : -1;
    return laneCenter + towardCenter * random.between(0.42, 0.64);
  }

  return laneCenter + random.between(-0.16, 0.16);
}
