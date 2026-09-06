import {
  DEFAULT_RACE_TO_WIN_CONFIG,
  TRACK_SEED,
  type RaceToWinConfig,
  mergeRaceToWinConfig,
} from "./config";
import { RaceToWinPrng } from "./prng";
import type {
  CollisionSnapshot,
  DisplayMetrics,
  LaneChangeDirection,
  LaneIndex,
  LaneInputEvent,
  PlayerSnapshot,
  RaceState,
  RaceToWinRunRecord,
  RaceToWinSnapshot,
  TrafficSnapshot,
} from "./types";

const LANE_INDICES: readonly LaneIndex[] = [0, 1, 2];

interface TrafficVehicle {
  id: number;
  waveId: number;
  laneIndex: LaneIndex;
  worldDistance: number;
  speedMps: number;
  variantIndex: number;
  isDoubleObstacle: boolean;
  active: boolean;
}

interface TrafficWave {
  id: number;
  laneIndices: readonly LaneIndex[];
  worldDistance: number;
  speedMps: number;
}

interface LaneTransition {
  from: LaneIndex;
  to: LaneIndex;
  elapsedMs: number;
}

export interface RaceToWinSimulationOptions {
  readonly seed?: number;
  readonly config?: Partial<RaceToWinConfig>;
  /** Number of visual traffic variants a renderer has registered. */
  readonly trafficVariantCount?: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function laneIndex(value: number): LaneIndex {
  return clamp(Math.round(value), 0, 2) as LaneIndex;
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

/**
 * Pure local simulation for the playable presentation. It makes no network
 * requests and never treats its display metrics as an official result.
 */
export class RaceToWinSimulation {
  public readonly config: RaceToWinConfig;

  private readonly trafficVariantCount: number;
  private seed: number;
  private prng: RaceToWinPrng;
  private state: RaceState = "ready";
  private accumulatorMs = 0;
  private simulationTimeMs = 0;
  private elapsedSeconds = 0;
  private playerDistanceMeters = 0;
  private currentSpeedMps = 0;
  private playerLane: LaneIndex = 1;
  private playerLaneX = 0;
  private transition: LaneTransition | null = null;
  private pendingInputs: LaneInputEvent[] = [];
  private acceptedInputs: LaneInputEvent[] = [];
  private nextInputSequence = 0;
  private nextSpawnAtSeconds = 0;
  private nextWaveId = 0;
  private nextPoolId = 0;
  private activePressurePhase = -1;
  private pressurePhaseWaveIndex = 0;
  private pressureSafeLaneIndex = 0;
  private lastPressureSafeLane: LaneIndex | null = null;
  private activeTraffic: TrafficVehicle[] = [];
  private recycledTraffic: TrafficVehicle[] = [];
  private activeWaves: TrafficWave[] = [];
  private collision: CollisionSnapshot | null = null;

  public constructor(options: RaceToWinSimulationOptions = {}) {
    this.config = mergeRaceToWinConfig(options.config);
    this.seed = (options.seed ?? TRACK_SEED) >>> 0;
    this.prng = new RaceToWinPrng(this.seed);
    this.trafficVariantCount = Math.max(1, Math.floor(options.trafficVariantCount ?? 1));
    this.reset(this.seed);
  }

  public reset(seed: number = this.seed): void {
    this.seed = seed >>> 0;
    this.prng = new RaceToWinPrng(this.seed);
    this.state = "ready";
    this.accumulatorMs = 0;
    this.simulationTimeMs = 0;
    this.elapsedSeconds = 0;
    this.playerDistanceMeters = 0;
    this.currentSpeedMps = this.config.initialSpeedMps;
    this.playerLane = 1;
    this.playerLaneX = this.config.lanes[this.playerLane];
    this.transition = null;
    this.pendingInputs = [];
    this.acceptedInputs = [];
    this.nextInputSequence = 0;
    this.nextSpawnAtSeconds = this.config.initialSpawnDelaySeconds;
    this.nextWaveId = 0;
    this.activePressurePhase = -1;
    this.pressurePhaseWaveIndex = 0;
    this.pressureSafeLaneIndex = 0;
    this.lastPressureSafeLane = null;
    this.collision = null;
    this.recycledTraffic.push(...this.activeTraffic);
    this.activeTraffic = [];
    this.activeWaves = [];
  }

  public start(): void {
    if (this.state === "ready") {
      this.state = "running";
    }
  }

  /**
   * Enqueues one lane input at simulation time. Inputs during a transition are
   * ignored to avoid keyboard-repeat / double-swipe glitches.
   */
  public requestLaneChange(direction: LaneChangeDirection): boolean {
    if (this.state !== "running" || this.transition !== null || this.pendingInputs.length > 0) {
      return false;
    }

    const desiredLane = laneIndex(this.playerLane + direction);
    if (desiredLane === this.playerLane) {
      return false;
    }

    this.pendingInputs.push({
      sequence: this.nextInputSequence++,
      atMs: Math.round(this.simulationTimeMs),
      direction,
    });
    return true;
  }

  /**
   * Replay helper. It only accepts valid, monotonic input records and is kept
   * separate from browser interaction so future validation can replay a run.
   */
  public queueReplayInput(input: LaneInputEvent): boolean {
    if (
      !Number.isSafeInteger(input.sequence) ||
      !Number.isFinite(input.atMs) ||
      input.atMs < this.simulationTimeMs ||
      (input.direction !== -1 && input.direction !== 1)
    ) {
      return false;
    }

    const last = this.pendingInputs[this.pendingInputs.length - 1];
    if (last && (input.atMs < last.atMs || input.sequence <= last.sequence)) {
      return false;
    }

    this.pendingInputs.push({
      sequence: input.sequence,
      atMs: Math.round(input.atMs),
      direction: input.direction,
    });
    this.nextInputSequence = Math.max(this.nextInputSequence, input.sequence + 1);
    return true;
  }

  /** Advance with real elapsed time; internals always run at a fixed timestep. */
  public step(frameDeltaMs: number): RaceToWinSnapshot {
    if (!Number.isFinite(frameDeltaMs) || frameDeltaMs <= 0 || this.state !== "running") {
      return this.snapshot();
    }

    this.accumulatorMs += Math.min(frameDeltaMs, this.config.maxFrameDeltaMs);
    while (this.accumulatorMs >= this.config.fixedStepMs && this.state === "running") {
      this.tick(this.config.fixedStepMs);
      this.accumulatorMs -= this.config.fixedStepMs;
    }

    return this.snapshot();
  }

  public snapshot(): RaceToWinSnapshot {
    const traffic: TrafficSnapshot[] = this.activeTraffic
      .filter((vehicle) => vehicle.active)
      .map((vehicle) => ({
        id: vehicle.id,
        waveId: vehicle.waveId,
        laneIndex: vehicle.laneIndex,
        laneX: this.config.lanes[vehicle.laneIndex],
        relativeDistance: vehicle.worldDistance - this.playerDistanceMeters,
        speedMps: vehicle.speedMps,
        variantIndex: vehicle.variantIndex,
        isDoubleObstacle: vehicle.isDoubleObstacle,
      }))
      .sort((left, right) => right.relativeDistance - left.relativeDistance);

    return {
      state: this.state,
      simulationTimeMs: Math.round(this.simulationTimeMs),
      seed: this.seed,
      player: this.playerSnapshot(),
      metrics: this.metrics(),
      traffic,
      collision: this.collision ? { ...this.collision } : null,
    };
  }

  public runRecord(): RaceToWinRunRecord {
    return {
      gameplayVersion: this.config.gameplayVersion,
      seed: this.seed,
      inputs: this.acceptedInputs.map((input) => ({ ...input })),
    };
  }

  private tick(stepMs: number): void {
    const deltaSeconds = stepMs / 1000;
    this.simulationTimeMs += stepMs;
    this.elapsedSeconds += deltaSeconds;
    this.currentSpeedMps = this.speedForElapsedTime();
    this.playerDistanceMeters += this.currentSpeedMps * deltaSeconds;

    this.processInputs();
    this.updateLaneTransition(stepMs);
    this.updateTraffic(deltaSeconds);
    this.spawnDueWaves();
    this.detectCollision();
  }

  private speedForElapsedTime(): number {
    const progress = clamp(this.elapsedSeconds / this.config.speedRampSeconds, 0, 1);
    // Ease-in keeps the first minute welcoming and avoids an abrupt difficulty wall.
    const easedProgress = 1 - (1 - progress) ** 2;
    return this.config.initialSpeedMps +
      (this.config.maxSpeedMps - this.config.initialSpeedMps) * easedProgress;
  }

  private processInputs(): void {
    while (this.pendingInputs[0] && this.pendingInputs[0].atMs <= this.simulationTimeMs) {
      const input = this.pendingInputs.shift()!;
      if (this.transition !== null) {
        continue;
      }

      const desiredLane = laneIndex(this.playerLane + input.direction);
      if (desiredLane === this.playerLane) {
        continue;
      }

      this.transition = {
        from: this.playerLane,
        to: desiredLane,
        elapsedMs: 0,
      };
      this.acceptedInputs.push(input);
    }
  }

  private updateLaneTransition(stepMs: number): void {
    if (!this.transition) {
      return;
    }

    this.transition.elapsedMs += stepMs;
    const progress = clamp(this.transition.elapsedMs / this.config.laneChangeDurationMs, 0, 1);
    const fromX = this.config.lanes[this.transition.from];
    const toX = this.config.lanes[this.transition.to];
    this.playerLaneX = fromX + (toX - fromX) * easeOutCubic(progress);

    if (progress === 1) {
      this.playerLane = this.transition.to;
      this.playerLaneX = this.config.lanes[this.playerLane];
      this.transition = null;
    }
  }

  private updateTraffic(deltaSeconds: number): void {
    for (const wave of this.activeWaves) {
      wave.worldDistance += wave.speedMps * deltaSeconds;
    }

    const retained: TrafficVehicle[] = [];
    for (const vehicle of this.activeTraffic) {
      vehicle.worldDistance += vehicle.speedMps * deltaSeconds;
      if (vehicle.worldDistance - this.playerDistanceMeters < -this.config.despawnBehindMeters) {
        vehicle.active = false;
        this.recycledTraffic.push(vehicle);
      } else {
        retained.push(vehicle);
      }
    }
    this.activeTraffic = retained;

    const activeWaveIds = new Set(this.activeTraffic.map((vehicle) => vehicle.waveId));
    this.activeWaves = this.activeWaves.filter((wave) => activeWaveIds.has(wave.id));
  }

  private spawnDueWaves(): void {
    while (
      this.elapsedSeconds >= this.nextSpawnAtSeconds &&
      this.activeTraffic.length < this.config.maxTrafficVehicles
    ) {
      this.spawnWave();
      const difficulty = this.difficulty();
      const interval = this.lerp(
        this.config.spawnIntervalStartSeconds,
        this.config.spawnIntervalEndSeconds,
        difficulty,
      );
      // Deterministic, small cadence variation prevents an obvious metronome.
      this.nextSpawnAtSeconds += interval * this.lerp(0.9, 1.1, this.prng.next());
    }
  }

  private spawnWave(): void {
    const difficulty = this.difficulty();
    const aheadMeters = this.lerp(
      this.config.spawnAheadMinMeters,
      this.config.spawnAheadMaxMeters,
      difficulty,
    );
    const speedFactor = this.lerp(
      this.config.trafficSpeedMinFactor,
      this.config.trafficSpeedMaxFactor,
      this.prng.next(),
    );
    const speedMps = this.currentSpeedMps * speedFactor;
    const worldDistance = this.playerDistanceMeters + aheadMeters;
    const pressureLayout = this.nextPressureLayout();
    const laneIndices = this.pickSurvivableLanePattern(
      worldDistance,
      speedMps,
      pressureLayout.wantsDouble,
      pressureLayout.preferredSafeLane,
    );
    // Dense traffic is desirable, but never at the expense of a physically
    // reachable lane. Skipping this deterministic spawn is safer than adding
    // a fallback obstacle that could close the only remaining route.
    if (!laneIndices) return;
    if (laneIndices.length === 2) {
      this.lastPressureSafeLane = LANE_INDICES.find((lane) => !laneIndices.includes(lane)) ?? null;
    }
    const waveId = this.nextWaveId++;

    this.activeWaves.push({ id: waveId, laneIndices, worldDistance, speedMps });
    for (const selectedLane of laneIndices) {
      const vehicle = this.acquireTrafficVehicle();
      vehicle.waveId = waveId;
      vehicle.laneIndex = selectedLane;
      vehicle.worldDistance = worldDistance;
      vehicle.speedMps = speedMps;
      vehicle.variantIndex = this.prng.intInclusive(0, this.trafficVariantCount - 1);
      vehicle.isDoubleObstacle = laneIndices.length === 2;
      vehicle.active = true;
      this.activeTraffic.push(vehicle);
    }
  }

  /**
   * A wave can block one or two lanes, never all three. Candidates are replayed
   * through a small lane reachability planner against approaching waves, which
   * rejects combinations that would remove every path to survival.
   */
  private pickSurvivableLanePattern(
    worldDistance: number,
    speedMps: number,
    wantsDouble: boolean,
    preferredSafeLane: LaneIndex | null,
  ): readonly LaneIndex[] | null {
    const candidates: LaneIndex[][] = wantsDouble
      ? [[0, 1], [0, 2], [1, 2]]
      : [[0], [1], [2]];

    const orderedCandidates = wantsDouble
      ? this.orderDoubleCandidates(candidates, preferredSafeLane)
      : this.rotateCandidates(candidates);

    for (const candidate of orderedCandidates) {
      if (!this.hasTrafficSeparation(candidate, worldDistance, speedMps)) continue;
      if (this.hasReachablePath([...this.activeWaves, {
        id: -1,
        laneIndices: candidate,
        worldDistance,
        speedMps,
      }])) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Uses a versioned, fixed cycle rather than independent random double-wave
   * rolls. Every successful double wave has a preferred safe corridor; the
   * planner may only fall back when that exact corridor would be unfair.
   */
  private nextPressureLayout(): { readonly wantsDouble: boolean; readonly preferredSafeLane: LaneIndex | null } {
    const phase = this.pressurePhaseIndex();
    if (phase !== this.activePressurePhase) {
      this.activePressurePhase = phase;
      this.pressurePhaseWaveIndex = 0;
    }

    const cycleLength = this.config.pressureWaveCycleLengths[phase]!;
    const doubleWaves = this.config.pressureDoubleWavesPerCycle[phase]!;
    const wantsDouble = this.pressurePhaseWaveIndex % cycleLength < doubleWaves;
    this.pressurePhaseWaveIndex += 1;

    if (!wantsDouble) {
      return { wantsDouble: false, preferredSafeLane: null };
    }

    const preferredSafeLane = this.config.pressureSafeLanePattern[
      this.pressureSafeLaneIndex % this.config.pressureSafeLanePattern.length
    ] as LaneIndex;
    this.pressureSafeLaneIndex += 1;
    return { wantsDouble: true, preferredSafeLane };
  }

  private pressurePhaseIndex(): number {
    const phase = this.config.pressurePhaseEndSeconds.findIndex((endSeconds) => this.elapsedSeconds < endSeconds);
    return phase === -1 ? this.config.pressureWaveCycleLengths.length - 1 : phase;
  }

  private orderDoubleCandidates(
    candidates: readonly LaneIndex[][],
    preferredSafeLane: LaneIndex | null,
  ): readonly LaneIndex[][] {
    const corridorOrder: LaneIndex[] = [];
    const addCorridor = (lane: LaneIndex | null) => {
      if (lane !== null && !corridorOrder.includes(lane)) corridorOrder.push(lane);
    };

    addCorridor(preferredSafeLane);
    for (const lane of LANE_INDICES) {
      if (lane !== this.lastPressureSafeLane) addCorridor(lane);
    }
    addCorridor(this.lastPressureSafeLane);

    return corridorOrder.map((safeLane) =>
      candidates.find((candidate) => !candidate.includes(safeLane))!,
    );
  }

  private rotateCandidates(candidates: readonly LaneIndex[][]): readonly LaneIndex[][] {
    const firstOffset = this.prng.intInclusive(0, candidates.length - 1);
    return candidates.map((_, index) => candidates[(firstOffset + index) % candidates.length]!);
  }

  /**
   * Prevent same-lane vehicle models from spawning into, or converging through,
   * one another during the look-ahead used by the path planner.
   */
  private hasTrafficSeparation(
    laneIndices: readonly LaneIndex[],
    worldDistance: number,
    speedMps: number,
  ): boolean {
    for (const vehicle of this.activeTraffic) {
      if (!vehicle.active || !laneIndices.includes(vehicle.laneIndex)) continue;
      const distanceAtSpawn = vehicle.worldDistance - worldDistance;
      const relativeSpeed = vehicle.speedMps - speedMps;
      const closestTime = Math.abs(relativeSpeed) < 0.0001
        ? 0
        : clamp(-distanceAtSpawn / relativeSpeed, 0, this.config.wavePlanningHorizonSeconds);
      const separation = Math.abs(distanceAtSpawn + relativeSpeed * closestTime);
      if (separation < this.config.minimumTrafficSeparationMeters) return false;
    }
    return true;
  }

  private hasReachablePath(waves: readonly TrafficWave[]): boolean {
    const futureWaves = waves
      .map((wave) => ({
        ...wave,
        arrivalSeconds: this.arrivalSeconds(wave.worldDistance, wave.speedMps),
      }))
      .filter((wave) => wave.arrivalSeconds > 0 && wave.arrivalSeconds <= this.config.wavePlanningHorizonSeconds)
      .sort((left, right) => left.arrivalSeconds - right.arrivalSeconds);

    let reachable = new Set<LaneIndex>([this.playerLane]);
    let previousArrival = 0;
    for (const wave of futureWaves) {
      const movementWindow = Math.max(
        0,
        wave.arrivalSeconds - previousArrival - this.config.reactionBufferSeconds,
      );
      const possibleMoves = Math.floor(movementWindow / (this.config.laneChangeDurationMs / 1000));
      const freeLanes = LANE_INDICES.filter((lane) => !wave.laneIndices.includes(lane));
      const nextReachable = new Set<LaneIndex>();

      for (const fromLane of reachable) {
        for (const freeLane of freeLanes) {
          if (Math.abs(freeLane - fromLane) <= possibleMoves) {
            nextReachable.add(freeLane);
          }
        }
      }

      if (nextReachable.size === 0) {
        return false;
      }

      reachable = nextReachable;
      previousArrival = wave.arrivalSeconds;
    }

    return true;
  }

  private arrivalSeconds(worldDistance: number, trafficSpeedMps: number): number {
    const relativeDistance = worldDistance - this.playerDistanceMeters;
    const closingSpeed = Math.max(1, this.currentSpeedMps - trafficSpeedMps);
    return relativeDistance / closingSpeed;
  }

  private acquireTrafficVehicle(): TrafficVehicle {
    const recycled = this.recycledTraffic.pop();
    if (recycled) {
      return recycled;
    }

    return {
      id: this.nextPoolId++,
      waveId: -1,
      laneIndex: 1,
      worldDistance: 0,
      speedMps: 0,
      variantIndex: 0,
      isDoubleObstacle: false,
      active: false,
    };
  }

  private detectCollision(): void {
    for (const vehicle of this.activeTraffic) {
      const relativeDistance = vehicle.worldDistance - this.playerDistanceMeters;
      const lateralDistance = Math.abs(this.config.lanes[vehicle.laneIndex] - this.playerLaneX);
      if (
        Math.abs(relativeDistance) <= this.config.collisionLongitudinalMeters &&
        lateralDistance <= this.config.collisionLateralMeters
      ) {
        this.state = "crashed";
        this.collision = {
          atMs: Math.round(this.simulationTimeMs),
          trafficId: vehicle.id,
          waveId: vehicle.waveId,
        };
        return;
      }
    }
  }

  private difficulty(): number {
    return clamp(this.elapsedSeconds / this.config.trafficDifficultyRampSeconds, 0, 1);
  }

  private playerSnapshot(): PlayerSnapshot {
    return {
      laneIndex: this.playerLane,
      targetLaneIndex: this.transition?.to ?? this.playerLane,
      laneX: this.playerLaneX,
      isChangingLanes: this.transition !== null,
    };
  }

  private metrics(): DisplayMetrics {
    return {
      score: Math.floor(this.playerDistanceMeters * this.config.scorePerMeter),
      elapsedSeconds: this.elapsedSeconds,
      distanceMeters: this.playerDistanceMeters,
      speedKph: this.currentSpeedMps * 3.6,
    };
  }

  private lerp(from: number, to: number, amount: number): number {
    return from + (to - from) * amount;
  }
}

export { DEFAULT_RACE_TO_WIN_CONFIG };
