import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// This is a local-only adversarial harness.  It receives the same public
// traffic snapshot that a renderer receives; it does not use a server secret
// or write to any remote service.
const require = createRequire(import.meta.url);
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};
const { RaceToWinSimulation } = require("../lib/game/race-to-win/simulation.ts");

function chooseLane(snapshot) {
  if (snapshot.player.isChangingLanes) return null;

  // Grouping by wave exposes no more than a renderer: vehicles in the same
  // row have the same public wave id and relative distance.  The harness
  // selects the safe corridor for the imminent row early enough to make a
  // two-lane transition when the track requires it.
  const waves = new Map();
  for (const traffic of snapshot.traffic) {
    if (traffic.relativeDistance < -5) continue;
    const wave = waves.get(traffic.waveId) ?? { distance: traffic.relativeDistance, blocked: new Set() };
    wave.distance = Math.min(wave.distance, traffic.relativeDistance);
    wave.blocked.add(traffic.laneIndex);
    waves.set(traffic.waveId, wave);
  }
  const imminent = [...waves.values()]
    .filter((wave) => wave.distance <= 110)
    .sort((left, right) => left.distance - right.distance)[0];
  if (!imminent) return null;

  const safe = [0, 1, 2].filter((lane) => !imminent.blocked.has(lane));
  if (safe.includes(snapshot.player.laneIndex)) return null;
  const target = safe.sort((left, right) =>
    Math.abs(left - snapshot.player.laneIndex) - Math.abs(right - snapshot.player.laneIndex),
  )[0];
  return target ?? null;
}

test("adversarial snapshot driver reaches the mid-run verification window", () => {
  const simulation = new RaceToWinSimulation({ seed: 987_654_321, trafficVariantCount: 6 });
  simulation.start();

  while (simulation.snapshot().state === "running" && simulation.snapshot().simulationTimeMs < 105_000) {
    const snapshot = simulation.snapshot();
    const lane = chooseLane(snapshot);
    if (lane !== null) {
      simulation.requestLaneChange(lane > snapshot.player.laneIndex ? 1 : -1);
    }
    simulation.step(1000 / 60);
  }

  const final = simulation.snapshot();
  assert.equal(final.state, "running", `predictive driver crashed at ${final.simulationTimeMs}ms`);
  assert.ok(final.simulationTimeMs >= 100_000);
});
