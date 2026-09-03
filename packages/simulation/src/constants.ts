/** Canonical server simulation cadence. Rendering and networking may run independently. */
export const TICK_RATE = 60;
export const FIXED_TIME_STEP_SECONDS = 1 / TICK_RATE;

export const TRACK_LENGTH_METERS = 5_000;
export const ROAD_HALF_WIDTH_METERS = 7;
export const LANE_WIDTH_METERS = 3.5;
export const LANE_CENTERS_METERS = [-5.25, -1.75, 1.75, 5.25] as const;

export const MAX_PLAYERS = 2;
export const MAX_SPEED_METERS_PER_SECOND = 90;
export const HARD_COLLISION_SPEED_METERS_PER_SECOND = 12;
export const RESPAWN_TICKS = 2 * TICK_RATE;
export const RESPAWN_IMMUNITY_TICKS = 1.5 * TICK_RATE;

export const BIKE_WIDTH_METERS = 0.78;
export const BIKE_LENGTH_METERS = 2.2;

export const DEFAULT_TRAFFIC_DENSITY_PER_LANE_KM = 12;
