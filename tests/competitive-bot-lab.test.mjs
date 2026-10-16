import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const lab = await import(new URL("../scripts/lab/competitive-bot.mjs", import.meta.url));

test("offline competitive bot lab has no network, browser, Supabase, credential, or filesystem-write surface", () => {
  const source = readFileSync(new URL("../scripts/lab/competitive-bot.mjs", import.meta.url), "utf8");
  assert.match(source, /OFFLINE-ONLY ANTI-AUTOMATION LAB/);
  assert.match(source, /RTW_OFFLINE_ANTI_AUTOMATION_LAB/);
  assert.doesNotMatch(source, /from\s+["'](?:@\/lib\/supabase|@supabase\/)|\bfetch\s*\(|\bWebSocket\s*\(|\bwriteFile(?:Sync)?\s*\(|\bappendFile(?:Sync)?\s*\(|\bspawn\s*\(|\bexec(?:File)?\s*\(/);
});

test("a source-aware predictive candidate is replay-verifiable without claiming human play", () => {
  const result = lab.runCompetitiveBot({ seed: 1, strategy: "predictive", durationMs: 120_000 });
  assert.equal(result.replayVerified, true);
  assert.equal(result.strategy, "predictive");
  assert.ok(result.elapsedMs > 0);
  assert.ok(result.score >= 0);
  assert.ok(result.timing.inputCount >= 0);
});

test("the benchmark keeps weak and noisy strategies distinct and reports measured rather than human-imputed timing", () => {
  const benchmark = lab.runLabBenchmark({ seeds: [1], durationMs: 60_000 });
  assert.equal(benchmark.offlineOnly, true);
  assert.deepEqual(Object.keys(benchmark.summary), ["passive", "cadenced", "predictive", "noisy-predictive"]);
  assert.equal(benchmark.runs.length, 4);
  for (const run of benchmark.runs) {
    assert.equal(run.replayVerified, true);
    assert.ok(run.timing.distinctIntervals >= 0);
  }
});
