import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../lib/game/race-to-win/antifraud.ts", import.meta.url), "utf8");
const module = { exports: {} };
new Function("module", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(module, module.exports);
const antiFraud = module.exports;

test("Race To Win sends only corroborated uniform high-frequency inputs to review", () => {
  const ordinary = Array.from({ length: 20 }, (_, sequence) => ({ sequence, atMs: sequence * 500, direction: sequence % 2 ? 1 : -1 }));
  assert.deepEqual(antiFraud.raceToWinReviewSignals(ordinary, 10_000), []);
  const automated = Array.from({ length: 80 }, (_, sequence) => ({ sequence, atMs: sequence * 100, direction: sequence % 2 ? 1 : -1 }));
  const signals = antiFraud.raceToWinReviewSignals(automated, 7_900);
  assert.deepEqual(signals, ["high_lane_change_density", "uniform_input_cadence"]);
  assert.equal(antiFraud.needsRaceToWinReview(signals), true);
});
