import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
const cache = new Map();

function load(path) {
  path = resolve(root, path);
  if (cache.has(path)) return cache.get(path).exports;
  const compiled = { exports: {} };
  cache.set(path, compiled);
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("exports", "module", "require", output)(compiled.exports, compiled,
    (name) => name.startsWith(".") ? load(resolve(dirname(path), `${name}.ts`)) : nativeRequire(name));
  return compiled.exports;
}

const { RaceToWinSimulation } = load("lib/game/race-to-win/simulation.ts");
const { DEFAULT_RACE_TO_WIN_CONFIG } = load("lib/game/race-to-win/config.ts");

function advance(simulation, milliseconds) {
  const steps = Math.ceil(milliseconds / DEFAULT_RACE_TO_WIN_CONFIG.fixedStepMs);
  for (let index = 0; index < steps && simulation.snapshot().state === "running"; index += 1) {
    simulation.step(DEFAULT_RACE_TO_WIN_CONFIG.fixedStepMs);
  }
  return simulation.snapshot();
}

function maxSpeedWaves(snapshot) {
  const grouped = new Map();
  for (const traffic of snapshot.traffic.filter((entry) => entry.isDoubleObstacle)) {
    const wave = grouped.get(traffic.waveId) ?? [];
    wave.push(traffic);
    grouped.set(traffic.waveId, wave);
  }
  return [...grouped.values()]
    .filter((wave) => wave.length === 2)
    .map((wave) => ({
      safeLane: [0, 1, 2].find((lane) => !wave.some((traffic) => traffic.laneIndex === lane)),
      arrival: wave[0].relativeDistance / (snapshot.metrics.speedKph / 3.6 - wave[0].speedMps),
    }))
    .sort((left, right) => left.arrival - right.arrival);
}

test("the max-speed phase forces close, varied, reachable safe corridors once per second", () => {
  const simulation = new RaceToWinSimulation({
    seed: 7,
    trafficVariantCount: 6,
    config: {
      initialSpeedMps: 100,
      maxSpeedMps: 100,
      speedRampSeconds: 1,
      initialSpawnDelaySeconds: 99,
      maxTrafficVehicles: 20,
    },
  });
  simulation.start();
  const seenWaves = new Map();
  let snapshot = simulation.snapshot();
  for (let index = 0; index < 240 && snapshot.state === "running"; index += 1) {
    const imminent = maxSpeedWaves(snapshot)[0];
    if (imminent && imminent.arrival > 0.3) {
      const direction = Math.sign(imminent.safeLane - snapshot.player.targetLaneIndex);
      if (direction) simulation.requestLaneChange(direction);
    }
    snapshot = simulation.step(DEFAULT_RACE_TO_WIN_CONFIG.fixedStepMs);
    for (const wave of maxSpeedWaves(snapshot)) {
      seenWaves.set(`${wave.safeLane}:${Math.round(wave.arrival * 100)}`, wave);
    }
  }
  const waves = [...seenWaves.values()].sort((left, right) => left.arrival - right.arrival);

  assert.equal(snapshot.state, "running", "a legal sequence can survive the close max-speed corridors");
  assert.ok(waves.length >= 3, "expected multiple scheduled max-speed corridors");
  assert.ok(waves.every((wave) => Number.isInteger(wave.safeLane)), "every wave leaves exactly one lane clear");
  assert.ok(waves.some((wave, index) => index > 0 && wave.safeLane !== waves[index - 1].safeLane), "a player must move for a subsequent corridor");
  assert.ok(new Set(waves.map((wave) => wave.safeLane)).size >= 2, "safe corridors must not be a fixed one-side pattern");
  assert.ok(waves.every((wave) => wave.arrival <= DEFAULT_RACE_TO_WIN_CONFIG.maxSpeedPressureLeadSeconds + 0.08), "max-speed traffic must be close, not parked far down the road");
  assert.ok(DEFAULT_RACE_TO_WIN_CONFIG.laneChangeDurationMs * 2 / 1000 + DEFAULT_RACE_TO_WIN_CONFIG.reactionBufferSeconds < DEFAULT_RACE_TO_WIN_CONFIG.maxSpeedPressureIntervalSeconds, "a two-lane correction retains a reaction buffer");
});
