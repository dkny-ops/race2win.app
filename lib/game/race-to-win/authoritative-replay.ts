import { GAMEPLAY_VERSION, DEFAULT_RACE_TO_WIN_CONFIG, LEGACY_V7_CONFIG, LEGACY_V8_CONFIG, LEGACY_V9_CONFIG, LEGACY_V10_CONFIG, LEGACY_V11_CONFIG, LEGACY_V12_CONFIG, LEGACY_V13_CONFIG, LEGACY_V14_CONFIG, LEGACY_V15_CONFIG, LEGACY_V16_CONFIG, LEGACY_V17_CONFIG, LEGACY_V18_CONFIG, LEGACY_V19_CONFIG } from "./config";
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
  return value === "rtw-v6" || value === "rtw-v7" || value === "rtw-v8" || value === "rtw-v9" || value === "rtw-v10" || value === "rtw-v11" || value === "rtw-v12" || value === "rtw-v13" || value === "rtw-v14" || value === "rtw-v15" || value === "rtw-v16" || value === "rtw-v17" || value === "rtw-v18" || value === "rtw-v19" || value === GAMEPLAY_VERSION;
}

export function replayAuthoritativeProgress(gameplayVersion: unknown, seed: number, inputs: readonly LaneInputEvent[], elapsedCapMs: number, verifiedProtectionAtMs: readonly number[] = []): AuthoritativeRaceProgress | null {
  if (!isAuthoritativeGameplayVersion(gameplayVersion)) return null;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(elapsedCapMs) || elapsedCapMs < 0) return null;
  if (inputs.length > MAX_OFFICIAL_INPUTS) return null;
  const simulation = new RaceToWinSimulation({ seed, trafficVariantCount: 6, config: gameplayVersion === GAMEPLAY_VERSION ? undefined : gameplayVersion === "rtw-v19" ? LEGACY_V19_CONFIG : gameplayVersion === "rtw-v18" ? LEGACY_V18_CONFIG : gameplayVersion === "rtw-v17" ? LEGACY_V17_CONFIG : gameplayVersion === "rtw-v16" ? LEGACY_V16_CONFIG : gameplayVersion === "rtw-v15" ? LEGACY_V15_CONFIG : gameplayVersion === "rtw-v14" ? LEGACY_V14_CONFIG : gameplayVersion === "rtw-v13" ? LEGACY_V13_CONFIG : gameplayVersion === "rtw-v12" ? LEGACY_V12_CONFIG : gameplayVersion === "rtw-v11" ? LEGACY_V11_CONFIG : gameplayVersion === "rtw-v10" ? LEGACY_V10_CONFIG : gameplayVersion === "rtw-v9" ? LEGACY_V9_CONFIG : gameplayVersion === "rtw-v8" ? LEGACY_V8_CONFIG : LEGACY_V7_CONFIG });
  let previousAtMs = -1;
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index]!;
    if (input.sequence !== index || !Number.isSafeInteger(input.atMs) || input.atMs < 0 || input.atMs < previousAtMs || input.atMs > elapsedCapMs || (input.direction !== -1 && input.direction !== 1)) return null;
    if (!simulation.queueReplayInput(input)) return null;
    previousAtMs = input.atMs;
  }
  if (verifiedProtectionAtMs.some((ms) => !Number.isSafeInteger(ms) || ms < 0 || ms > elapsedCapMs)) return null;
  const protectedTicks = [...new Set(verifiedProtectionAtMs)].sort((a, b) => a - b);
  let nextProtection = 0;
  simulation.start();
  const stepMs = DEFAULT_RACE_TO_WIN_CONFIG.fixedStepMs;
  while (simulation.snapshot().state === "running" && simulation.snapshot().simulationTimeMs + stepMs <= elapsedCapMs) {
    while (nextProtection < protectedTicks.length && Math.round(simulation.snapshot().simulationTimeMs) >= protectedTicks[nextProtection]!) {
      simulation.protectForFiveSeconds();
      nextProtection += 1;
    }
    simulation.step(stepMs);
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

export function replayAuthoritativeRace(gameplayVersion: unknown, seed: number, inputs: readonly LaneInputEvent[], elapsedCapMs: number, verifiedProtectionAtMs: readonly number[] = []): AuthoritativeRaceResult | null {
  const progress = replayAuthoritativeProgress(gameplayVersion, seed, inputs, elapsedCapMs, verifiedProtectionAtMs);
  if (!progress || progress.state !== "crashed" || progress.collisionAtMs === null) return null;
  return {
    score: progress.score,
    distanceMillimeters: progress.distanceMillimeters,
    elapsedMs: progress.elapsedMs,
    collisionAtMs: progress.collisionAtMs,
  };
}
