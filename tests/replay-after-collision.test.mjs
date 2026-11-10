import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
require.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};
const { replayAuthoritativeProgress, replayAuthoritativeRace } = require("../lib/game/race-to-win/authoritative-replay.ts");
const { RaceToWinSimulation } = require("../lib/game/race-to-win/simulation.ts");

test("replay rejects input evidence after the authoritative collision", () => {
  const legitimate = replayAuthoritativeRace("rtw-v10", 1, [], 10_000);
  assert.ok(legitimate, "a genuine collision must remain finalizable");
  const forged = [{ sequence: 0, atMs: legitimate.collisionAtMs + 100, direction: 1 }];
  assert.equal(replayAuthoritativeProgress("rtw-v10", 1, forged, 10_000), null);
  assert.equal(replayAuthoritativeRace("rtw-v10", 1, forged, 10_000), null);
});

test("replay rejects events left queued at a rounded collision boundary", () => {
  for (const [version, seed] of [["rtw-v6", 25], ["rtw-v7", 25], ["rtw-v8", 5], ["rtw-v9", 25]]) {
    const legitimate = replayAuthoritativeRace(version, seed, [], 30_000);
    assert.ok(legitimate);
    const forged = [{ sequence: 0, atMs: legitimate.collisionAtMs, direction: 1 }];
    assert.equal(replayAuthoritativeRace(version, seed, forged, 30_000), null);
  }
});

test("a legitimately recorded lane change can still be replayed after a crash", () => {
  const simulation = new RaceToWinSimulation({ seed: 1, trafficVariantCount: 6 });
  simulation.start();
  assert.equal(simulation.requestLaneChange(1), true);
  while (simulation.snapshot().state === "running" && simulation.snapshot().simulationTimeMs < 60_000) {
    simulation.step(1000 / 60);
  }
  const snapshot = simulation.snapshot();
  const record = simulation.runRecord();
  assert.equal(snapshot.state, "crashed");
  assert.equal(record.inputs.length, 1);
  const replay = replayAuthoritativeRace(record.gameplayVersion, 1, record.inputs, snapshot.simulationTimeMs + 100);
  assert.ok(replay);
  assert.equal(replay.score, snapshot.metrics.score);
});

test("rapid lane changes replay on the same ticks after a verified human-check pause", () => {
  const seed = 1;
  const simulation = new RaceToWinSimulation({ seed, trafficVariantCount: 6 });
  simulation.start();
  const stepMs = simulation.config.fixedStepMs;
  for (let tick = 0; tick < 40; tick++) {
    if (tick >= 3) simulation.requestLaneChange(simulation.snapshot().player.laneIndex === 1 ? -1 : 1);
    simulation.step(stepMs);
  }

  // The client suspends simulation frames while the challenge is open.
  const paused = simulation.snapshot();
  const prefix = simulation.runRecord();
  const progress = replayAuthoritativeProgress(prefix.gameplayVersion, seed, prefix.inputs, paused.simulationTimeMs);
  assert.equal(progress?.elapsedMs, paused.simulationTimeMs);
  assert.equal(progress?.state, "running");
  assert.equal(progress?.score, paused.metrics.score);

  // Only successful server verification supplies this protection tick.
  simulation.protectForFiveSeconds();
  for (let tick = 0; tick < 1500 && simulation.snapshot().state === "running"; tick++) {
    simulation.requestLaneChange(simulation.snapshot().player.laneIndex === 1 ? -1 : 1);
    simulation.step(stepMs);
  }

  const finish = simulation.snapshot();
  const record = simulation.runRecord();
  assert.equal(finish.state, "crashed");
  assert.ok(record.inputs.length > prefix.inputs.length);
  assert.deepEqual(record.inputs.slice(0, prefix.inputs.length), prefix.inputs);
  const wallClockCap = finish.simulationTimeMs + 10_000;
  const protections = [paused.simulationTimeMs];
  assert.deepEqual(replayAuthoritativeRace(record.gameplayVersion, seed, record.inputs, wallClockCap, protections), {
    score: finish.metrics.score,
    distanceMillimeters: Math.round(finish.metrics.distanceMeters * 1000),
    elapsedMs: finish.simulationTimeMs,
    collisionAtMs: finish.collision.atMs,
  });
  assert.equal(replayAuthoritativeRace(record.gameplayVersion, seed, record.inputs, wallClockCap), null);
  const forged = [...record.inputs, { sequence: record.inputs.length, atMs: finish.simulationTimeMs + 1, direction: 1 }];
  assert.equal(replayAuthoritativeRace(record.gameplayVersion, seed, forged, wallClockCap, protections), null);
});
