/**
 * Rules that define a Race To Win run. Keep this object versioned: a future
 * server-side validator must use the exact same constants for replay.
 */
// Increment whenever an authoritative simulation rule changes. A session is
// replayed only by the exact version that created it.
export const GAMEPLAY_VERSION = "rtw-v5";
export const TRACK_SEED = 987_654_321;
// Retained as an alias so existing consumers keep the versioned replay contract.
export const RACE_TO_WIN_GAMEPLAY_VERSION = GAMEPLAY_VERSION;

export interface RaceToWinConfig {
  readonly gameplayVersion: string;
  readonly lanes: readonly [-5, 0, 5];
  readonly fixedStepMs: number;
  readonly maxFrameDeltaMs: number;
  readonly laneChangeDurationMs: number;
  readonly reactionBufferSeconds: number;
  readonly initialSpeedMps: number;
  readonly maxSpeedMps: number;
  readonly speedRampSeconds: number;
  readonly trafficDifficultyRampSeconds: number;
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
  /** Phase boundaries for the deterministic pressure pattern. */
  readonly pressurePhaseEndSeconds: readonly number[];
  /** Number of two-lane waves in each matching pressure-pattern cycle. */
  readonly pressureDoubleWavesPerCycle: readonly number[];
  /** Total waves in each matching pressure-pattern cycle. */
  readonly pressureWaveCycleLengths: readonly number[];
  /** The corridor to leave clear for successive forced two-lane waves. */
  readonly pressureSafeLanePattern: readonly (0 | 1 | 2)[];
  readonly wavePlanningHorizonSeconds: number;
  readonly minimumTrafficSeparationMeters: number;
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
  // Short enough to demand a quick read, but still leaves one full lane move
  // whenever the reachability planner accepts a changing safe corridor.
  reactionBufferSeconds: 0.42,
  initialSpeedMps: 34,
  // The opening is immediately active: 322 km/h at one minute, 391 km/h at
  // 90 seconds, 440 km/h at two minutes, then 480 km/h at three minutes.
  maxSpeedMps: 480 / 3.6,
  speedRampSeconds: 180,
  // Spawn cadence reaches its full pressure at one minute, so 60–90 seconds
  // already demand continuous lane reading rather than a warm-up cruise.
  trafficDifficultyRampSeconds: 60,
  collisionLongitudinalMeters: 4.6,
  collisionLateralMeters: 2.1,
  despawnBehindMeters: 18,
  initialSpawnDelaySeconds: 0.3,
  // At the v4 cap these produce roughly 0.7–2.4 seconds of approach time,
  // depending on traffic speed. The planner rejects any chain that is not
  // physically reachable from the current lane.
  spawnAheadMinMeters: 70,
  spawnAheadMaxMeters: 160,
  // More obstacle groups throughout the run. The controlled lane pattern,
  // rather than random spam, keeps this denser cadence physically fair.
  spawnIntervalStartSeconds: 0.52,
  spawnIntervalEndSeconds: 0.32,
  // Traffic travels in the same direction as the player. This gives every
  // wave a readable approach time instead of spawning static walls.
  trafficSpeedMinFactor: 0.22,
  trafficSpeedMaxFactor: 0.5,
  // Dense, deterministic pressure by phase: 2/3, 3/4, 4/5, 5/6, then 6/7
  // waves are doubles. A single wave remains in every cycle as a fair reset.
  pressurePhaseEndSeconds: Object.freeze([20, 45, 70, 100]),
  pressureDoubleWavesPerCycle: Object.freeze([2, 3, 4, 5, 6]),
  pressureWaveCycleLengths: Object.freeze([3, 4, 5, 6, 7]),
  // Two consecutive doubles share one corridor, then it moves one lane at a
  // time. This produces rapid, repeatable decisions without requiring an
  // impossible right-to-left jump between adjacent obstacle groups.
  pressureSafeLanePattern: Object.freeze([2, 2, 1, 1, 0, 0, 1, 1]) as readonly (0 | 1 | 2)[],
  wavePlanningHorizonSeconds: 10,
  // Vehicle instances are about 5.25 m long, so this leaves more than 2 m
  // between same-lane cars while allowing denser, non-overlapping groups.
  minimumTrafficSeparationMeters: 7.5,
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
