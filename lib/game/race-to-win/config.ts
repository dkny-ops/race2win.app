/**
 * Rules that define a Race To Win run. Keep this object versioned: a future
 * server-side validator must use the exact same constants for replay.
 */
export const GAMEPLAY_VERSION = "rtw-v1";
export const TRACK_SEED = 987_654_321;
// Retained as an alias so existing consumers keep the versioned replay contract.
export const RACE_TO_WIN_GAMEPLAY_VERSION = GAMEPLAY_VERSION;

export interface RaceToWinConfig {
  readonly gameplayVersion: string;
  readonly lanes: readonly [-5, 0, 5];
  readonly fixedStepMs: number;
  readonly maxFrameDeltaMs: number;
  readonly laneChangeDurationMs: number;
  readonly initialSpeedMps: number;
  readonly maxSpeedMps: number;
  readonly speedRampSeconds: number;
  readonly collisionLongitudinalMeters: number;
  readonly collisionLateralMeters: number;
  readonly despawnBehindMeters: number;
  readonly initialSpawnDelaySeconds: number;
  readonly spawnAheadMinMeters: number;
  readonly spawnAheadMaxMeters: number;
  readonly spawnIntervalStartSeconds: number;
  readonly spawnIntervalEndSeconds: number;
  readonly trafficSpeedMinFactor: number;
  readonly trafficSpeedMaxFactor: number;
  readonly doubleObstacleStartProbability: number;
  readonly doubleObstacleEndProbability: number;
  readonly wavePlanningHorizonSeconds: number;
  readonly maxTrafficVehicles: number;
  readonly scorePerMeter: number;
}

/**
 * Metres and seconds are used throughout the simulation. Renderers may map
 * them to scene units, but must not change the simulation constants.
 */
export const DEFAULT_RACE_TO_WIN_CONFIG: RaceToWinConfig = Object.freeze({
  gameplayVersion: RACE_TO_WIN_GAMEPLAY_VERSION,
  lanes: Object.freeze([-5, 0, 5]) as readonly [-5, 0, 5],
  fixedStepMs: 1000 / 60,
  // Avoid simulating a huge catch-up jump when a browser tab resumes.
  maxFrameDeltaMs: 100,
  laneChangeDurationMs: 190,
  initialSpeedMps: 27,
  maxSpeedMps: 46,
  speedRampSeconds: 150,
  collisionLongitudinalMeters: 4.6,
  collisionLateralMeters: 2.1,
  despawnBehindMeters: 18,
  initialSpawnDelaySeconds: 0.55,
  spawnAheadMinMeters: 58,
  spawnAheadMaxMeters: 76,
  spawnIntervalStartSeconds: 2.15,
  spawnIntervalEndSeconds: 1.32,
  // Traffic travels in the same direction as the player. This gives every
  // wave a readable approach time instead of spawning static walls.
  trafficSpeedMinFactor: 0.28,
  trafficSpeedMaxFactor: 0.55,
  doubleObstacleStartProbability: 0.08,
  doubleObstacleEndProbability: 0.25,
  wavePlanningHorizonSeconds: 9,
  maxTrafficVehicles: 30,
  // Display-only score: one point per ten simulated metres. It deliberately
  // grows at a readable arcade-racing pace and is never an official result.
  scorePerMeter: 0.1,
});

export function mergeRaceToWinConfig(
  overrides: Partial<RaceToWinConfig> = {},
): RaceToWinConfig {
  return Object.freeze({
    ...DEFAULT_RACE_TO_WIN_CONFIG,
    ...overrides,
    lanes: overrides.lanes ?? DEFAULT_RACE_TO_WIN_CONFIG.lanes,
  });
}
