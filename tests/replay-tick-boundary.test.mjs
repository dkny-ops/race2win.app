import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
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
    name => name.startsWith(".") ? load(resolve(dirname(path), `${name}.ts`)) : require(name));
  return compiled.exports;
}
const { RaceToWinSimulation } = load("lib/game/race-to-win/simulation.ts");
const { replayAuthoritativeRace, replayAuthoritativeProgress } = load("lib/game/race-to-win/authoritative-replay.ts");
const { GAMEPLAY_VERSION, DEFAULT_RACE_TO_WIN_CONFIG: config } = load("lib/game/race-to-win/config.ts");

test("replay includes the rounded collision tick and excludes the preceding millisecond", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const simulation = new RaceToWinSimulation({ seed, trafficVariantCount: 6 });
    simulation.start();
    let snapshot = simulation.snapshot();
    for (let ticks = 0; ticks < 36000 && snapshot.state === "running"; ticks++) {
      snapshot = simulation.step(config.fixedStepMs);
    }
    assert.equal(snapshot.state, "crashed");
    const result = replayAuthoritativeRace(GAMEPLAY_VERSION, seed, [], snapshot.simulationTimeMs);
    assert.ok(result, `seed ${seed}, cap ${snapshot.simulationTimeMs}`);
    assert.equal(result.score, snapshot.metrics.score);
    assert.equal(result.elapsedMs, snapshot.simulationTimeMs);
    assert.equal(result.distanceMillimeters, Math.round(snapshot.metrics.distanceMeters * 1000));
    assert.equal(replayAuthoritativeRace(GAMEPLAY_VERSION, seed, [], snapshot.simulationTimeMs - 1), null);
    assert.deepEqual(replayAuthoritativeRace(GAMEPLAY_VERSION, seed, [], snapshot.simulationTimeMs + 100), result);
  }
});

test("replay rejects unsupported versions and tampered ordered evidence", () => {
  assert.equal(replayAuthoritativeProgress("unsupported", 1, [], 100), null);
  assert.equal(replayAuthoritativeProgress(GAMEPLAY_VERSION, 1, [{ sequence: 1, atMs: 0, direction: 1 }], 100), null);
  assert.equal(replayAuthoritativeProgress(GAMEPLAY_VERSION, 1, [{ sequence: 0, atMs: 101, direction: 1 }], 100), null);
  assert.equal(replayAuthoritativeProgress(GAMEPLAY_VERSION, -1, [], 100), null);
  assert.equal(replayAuthoritativeProgress(GAMEPLAY_VERSION, 1, [], NaN), null);
});
