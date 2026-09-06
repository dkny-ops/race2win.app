import { GAMEPLAY_VERSION, DEFAULT_RACE_TO_WIN_CONFIG } from "./config";
import { RaceToWinSimulation } from "./simulation";
import type { LaneInputEvent } from "./types";

export const MAX_OFFICIAL_INPUTS = 4096;

export interface AuthoritativeRaceResult {
  readonly score: number;
  readonly distanceMillimeters: number;
  readonly elapsedMs: number;
  readonly collisionAtMs: number;
}

/** Pure server-safe replay: no browser, Three.js, DOM, or client metrics. */
export function replayAuthoritativeRace(seed: number, inputs: readonly LaneInputEvent[], elapsedCapMs: number): AuthoritativeRaceResult | null {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(elapsedCapMs) || elapsedCapMs < 0) return null;
  if (inputs.length > MAX_OFFICIAL_INPUTS) return null;
  const simulation = new RaceToWinSimulation({ seed, trafficVariantCount: 6 });
  let previousAtMs = -1;
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index]!;
    if (input.sequence !== index || !Number.isSafeInteger(input.atMs) || input.atMs < 0 || input.atMs < previousAtMs || input.atMs > elapsedCapMs || (input.direction !== -1 && input.direction !== 1)) return null;
    if (!simulation.queueReplayInput(input)) return null;
    previousAtMs = input.atMs;
  }
  simulation.start();
  const stepMs = DEFAULT_RACE_TO_WIN_CONFIG.fixedStepMs;
  while (simulation.snapshot().state === "running" && simulation.snapshot().simulationTimeMs + stepMs <= elapsedCapMs) simulation.step(stepMs);
  const snapshot = simulation.snapshot();
  if (snapshot.state !== "crashed" || !snapshot.collision) return null;
  return {
    score: snapshot.metrics.score,
    distanceMillimeters: Math.round(snapshot.metrics.distanceMeters * 1000),
    elapsedMs: snapshot.simulationTimeMs,
    collisionAtMs: snapshot.collision.atMs,
  };
}

export function isAuthoritativeGameplayVersion(value: unknown): value is typeof GAMEPLAY_VERSION {
  return value === GAMEPLAY_VERSION;
}
