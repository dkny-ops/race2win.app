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

export interface AuthoritativeRaceProgress {
  readonly score: number;
  readonly distanceMillimeters: number;
  readonly elapsedMs: number;
  readonly collisionAtMs: number | null;
  readonly state: "running" | "crashed";
}

/** Pure server-safe replay: no browser, Three.js, DOM, or client metrics. */
/**
 * rtw-v6 sessions remain replayable while their short historical lifecycle
 * exists. New sessions are rtw-v7 and use the renewable activity lease.
 */
export function isAuthoritativeGameplayVersion(value: unknown): value is string {
  return value === "rtw-v6" || value === GAMEPLAY_VERSION;
}

export function replayAuthoritativeProgress(gameplayVersion: unknown, seed: number, inputs: readonly LaneInputEvent[], elapsedCapMs: number): AuthoritativeRaceProgress | null {
  if (!isAuthoritativeGameplayVersion(gameplayVersion)) return null;
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
  // Evidence timestamps are rounded milliseconds. Count fixed ticks instead
  // of adding a fractional step to an already-rounded snapshot timestamp.
  // This includes the collision tick when its rounded timestamp equals cap.
  let ticks = 0;
  while (simulation.snapshot().state === "running" && Math.round((ticks + 1) * stepMs) <= elapsedCapMs) {
    simulation.step(stepMs);
    ticks += 1;
  }
  const snapshot = simulation.snapshot();
  if (snapshot.state !== "running" && snapshot.state !== "crashed") return null;
  return {
    score: snapshot.metrics.score,
    distanceMillimeters: Math.round(snapshot.metrics.distanceMeters * 1000),
    elapsedMs: snapshot.simulationTimeMs,
    collisionAtMs: snapshot.collision?.atMs ?? null,
    state: snapshot.state,
  };
}

export function replayAuthoritativeRace(gameplayVersion: unknown, seed: number, inputs: readonly LaneInputEvent[], elapsedCapMs: number): AuthoritativeRaceResult | null {
  const progress = replayAuthoritativeProgress(gameplayVersion, seed, inputs, elapsedCapMs);
  if (!progress || progress.state !== "crashed" || progress.collisionAtMs === null) return null;
  return {
    score: progress.score,
    distanceMillimeters: progress.distanceMillimeters,
    elapsedMs: progress.elapsedMs,
    collisionAtMs: progress.collisionAtMs,
  };
}
