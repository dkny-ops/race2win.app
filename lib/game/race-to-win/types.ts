import type { RaceToWinConfig } from "./config";

export type LaneIndex = 0 | 1 | 2;
export type LaneChangeDirection = -1 | 1;
export type RaceState = "ready" | "running" | "crashed";

/** Input accepted by the simulation, not a claim of an official game result. */
export interface LaneInputEvent {
  readonly sequence: number;
  readonly atMs: number;
  readonly direction: LaneChangeDirection;
}

export interface PlayerSnapshot {
  readonly laneIndex: LaneIndex;
  readonly targetLaneIndex: LaneIndex;
  readonly laneX: number;
  readonly isChangingLanes: boolean;
}

export interface TrafficSnapshot {
  /** Stable pool slot; renderers can use it as a React/Three key. */
  readonly id: number;
  readonly waveId: number;
  readonly laneIndex: LaneIndex;
  readonly laneX: number;
  /** Positive values are in front of the player; negative are behind. */
  readonly relativeDistance: number;
  readonly speedMps: number;
  readonly variantIndex: number;
  readonly isDoubleObstacle: boolean;
}

export interface DisplayMetrics {
  /** UI-only values. They are deliberately not official or submit-ready. */
  readonly score: number;
  readonly elapsedSeconds: number;
  readonly distanceMeters: number;
  readonly speedKph: number;
}

export interface CollisionSnapshot {
  readonly atMs: number;
  readonly trafficId: number;
  readonly waveId: number;
}

export interface RaceToWinSnapshot {
  readonly state: RaceState;
  readonly simulationTimeMs: number;
  readonly seed: number;
  readonly player: PlayerSnapshot;
  readonly metrics: DisplayMetrics;
  readonly traffic: readonly TrafficSnapshot[];
  readonly collision: CollisionSnapshot | null;
}

/**
 * Compact material that a future trusted server could replay against a known
 * gameplay version. It is not proof that a browser run is valid.
 */
export interface RaceToWinRunRecord {
  readonly gameplayVersion: RaceToWinConfig["gameplayVersion"];
  readonly seed: number;
  readonly inputs: readonly LaneInputEvent[];
}
