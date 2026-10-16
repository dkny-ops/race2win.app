import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeRequire = createRequire(import.meta.url);
const cache = new Map();
function load(path) {
  path = resolve(root, path);
  if (cache.has(path)) return cache.get(path).exports;
  const compiledModule = { exports: {} }; cache.set(path, compiledModule);
  const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("exports", "module", "require", output)(compiledModule.exports, compiledModule, name => name.startsWith(".") ? load(resolve(dirname(path), `${name}.ts`)) : nativeRequire(name));
  return compiledModule.exports;
}

const { assessAntiAutomationRisk, parseControlTelemetry } = load("lib/security/anti-automation.ts");
const finalizeSource = readFileSync(resolve(root, "app/api/game-sessions/finalize/route.ts"), "utf8");

const normalKeyboard = { version: 1, keyboardEvents: 14, touchEvents: 0, pointerEvents: 0, trustedEvents: 14, untrustedEvents: 0, webdriverReported: false };
const syntheticWebdriver = { version: 1, keyboardEvents: 0, touchEvents: 0, pointerEvents: 12, trustedEvents: 0, untrustedEvents: 12, webdriverReported: true };
const cadencedInputs = Array.from({ length: 12 }, (_, index) => 250 + index * 500);

test("a physically valid keyboard player with repeated timing is not automatically held or rejected", () => {
  const assessment = assessAntiAutomationRisk(cadencedInputs, parseControlTelemetry(normalKeyboard));
  assert.equal(assessment.status, "verified");
  assert.deepEqual(assessment.signals, ["uniform_input_cadence"]);
});

test("corroborated synthetic-environment telemetry requests review but never changes a replay into rejection", () => {
  const assessment = assessAntiAutomationRisk(cadencedInputs, parseControlTelemetry(syntheticWebdriver));
  assert.equal(assessment.status, "review_required");
  assert.deepEqual(assessment.signals, ["uniform_input_cadence", "webdriver_reported", "untrusted_input_events"]);
});

test("forgeable telemetry cannot manufacture score authority", () => {
  const forged = parseControlTelemetry({ ...syntheticWebdriver, webdriverReported: false, trustedEvents: 12, untrustedEvents: 0 });
  const assessment = assessAntiAutomationRisk(cadencedInputs, forged);
  assert.equal(assessment.status, "verified");
  assert.deepEqual(assessment.signals, ["uniform_input_cadence"]);
  assert.deepEqual(parseControlTelemetry({ ...normalKeyboard, score: 999999 }), normalKeyboard, "extra fields are discarded");
  assert.equal(parseControlTelemetry({ version: 1, keyboardEvents: -1 }), null);
});

test("the official FINALIZE route derives risk only after authoritative replay and exposes no client-selected disposition", () => {
  assert.match(finalizeSource, /replayAuthoritativeProgress\([\s\S]*assessAntiAutomationRisk/);
  assert.match(finalizeSource, /body\.inputs\.map\(\(input\) => input\.atMs\)/);
  assert.match(finalizeSource, /game_session\.risk_review_required/);
  assert.doesNotMatch(finalizeSource, /body\.(?:risk|reviewRequired|human|verified)/);
});
