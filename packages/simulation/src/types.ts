export interface RiderInput {
  /** Normalized accelerator pressure in the inclusive range [0, 1]. */
  throttle: number;
  /** Normalized brake pressure in the inclusive range [0, 1]. */
  brake: number;
  /** Normalized steering in the inclusive range [-1, 1]. */
  steer: number;
}

export type RiderInputLike = Partial<RiderInput> | null | undefined;

export type PlayerStatus = "racing" | "knockedDown" | "finished";

export interface FinishTime {
  /** Fixed simulation tick in which the finish line was crossed. */
  tick: number;
  /** Fraction of the fixed tick at which the crossing occurred. */
  subTick: number;
  seconds: number;
}

export interface PlayerState {
  id: string;
  lateralPosition: number;
  distance: number;
  longitudinalSpeed: number;
  lateralSpeed: number;
  headingRadians: number;
  status: PlayerStatus;
  respawnTicksRemaining: number;
  immunityTicksRemaining: number;
  finish: FinishTime | null;
}

export type TrafficKind = "car" | "van" | "truck";

export interface TrafficVehicleState {
  id: string;
  kind: TrafficKind;
  laneIndex: number;
  lateralPosition: number;
  distance: number;
  speed: number;
  width: number;
  length: number;
}

export interface RaceRanking {
  playerId: string;
  position: number;
  finished: boolean;
  distance: number;
  finish: FinishTime | null;
}

export interface RaceResult {
  completedAtTick: number;
  winnerIds: string[];
  rankings: RaceRanking[];
}

export interface SimulationState {
  version: 1;
  seed: number;
  tick: number;
  players: PlayerState[];
  traffic: TrafficVehicleState[];
  /** Pair-keyed cooldowns prevent an overlap from producing a collision every tick. */
  collisionCooldowns: Record<string, number>;
  result: RaceResult | null;
}

export type CollisionSeverity = "soft" | "hard";
export type CollisionTarget = "traffic" | "player";

export type SimulationEvent =
  | {
      type: "collision";
      tick: number;
      playerIds: string[];
      targetType: CollisionTarget;
      targetId: string;
      impactSpeed: number;
      severity: CollisionSeverity;
    }
  | {
      type: "knockdown";
      tick: number;
      playerId: string;
      impactSpeed: number;
    }
  | {
      type: "respawn";
      tick: number;
      playerId: string;
      lateralPosition: number;
    }
  | {
      type: "finish";
      tick: number;
      playerId: string;
      finish: FinishTime;
    }
  | {
      type: "raceFinished";
      tick: number;
      result: RaceResult;
    };

export type InputsByPlayer = Readonly<Record<string, RiderInputLike>>;

export interface SimulationStep {
  state: SimulationState;
  events: SimulationEvent[];
}
