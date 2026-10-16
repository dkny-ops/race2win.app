import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
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
const { TRACK_SEED, DEFAULT_RACE_TO_WIN_CONFIG: config } = load("lib/game/race-to-win/config.ts");

function advance(simulation, milliseconds) {
  let snapshot = simulation.snapshot();
  const ticks = Math.ceil(milliseconds / config.fixedStepMs);
  for (let tick = 0; tick < ticks && snapshot.state === "running"; tick += 1) {
    snapshot = simulation.step(config.fixedStepMs);
  }
  return snapshot;
}

test("the guest opening has a reachable safe lane and a normal first maneuver survives the early traffic", () => {
  const untouched = new RaceToWinSimulation({ seed: TRACK_SEED, trafficVariantCount: 6 });
  untouched.start();
  const opening = advance(untouched, 500);

  // The initial deterministic wave may pressure the starting lane, but must
  // leave a corridor. This makes a crash from no input meaningful while still
  // giving a player enough physical time to move once GO is shown.
  assert.ok(opening.traffic.length > 0, "expected the deterministic opening wave");
  assert.ok(!opening.traffic.some((traffic) => traffic.laneIndex === 2), "right lane must be the opening corridor");

  const maneuvered = new RaceToWinSimulation({ seed: TRACK_SEED, trafficVariantCount: 6 });
  maneuvered.start();
  assert.equal(maneuvered.requestLaneChange(1), true, "right input is accepted once the run starts");
  const afterOpening = advance(maneuvered, 3_500);

  assert.equal(afterOpening.state, "running", "a normal opening maneuver must survive beyond the old early-crash window");
  assert.equal(afterOpening.player.laneIndex, 2);
  assert.ok(afterOpening.metrics.elapsedSeconds >= 3.4);
});
