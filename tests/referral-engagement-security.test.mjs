import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nativeRequire = createRequire(import.meta.url);
const cache = new Map();

function load(path) {
  path = resolve(root, path);
  if (cache.has(path)) return cache.get(path).exports;
  const compiled = { exports: {} };
  cache.set(path, compiled);
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('exports', 'module', 'require', output)(compiled.exports, compiled,
    name => name.startsWith('.') ? load(resolve(dirname(path), `${name}.ts`)) : nativeRequire(name));
  return compiled.exports;
}

const {
  hasMeaningfulReferralEvidence,
  replayAuthoritativeProgress,
} = load('lib/game/race-to-win/authoritative-replay.ts');
const { RaceToWinSimulation } = load('lib/game/race-to-win/simulation.ts');
const { DEFAULT_RACE_TO_WIN_CONFIG: config } = load('lib/game/race-to-win/config.ts');
const { GAMEPLAY_VERSION } = load('lib/game/race-to-win/config.ts');
const evidenceMigration = readFileSync(resolve(root, 'supabase/migrations/20261011000100_gate_referral_days_on_replay_evidence.sql'), 'utf8');
const finalizeRoute = readFileSync(resolve(root, 'app/api/game-sessions/finalize/route.ts'), 'utf8');

function replay(seed, inputs, cap = 120_000) {
  return replayAuthoritativeProgress(GAMEPLAY_VERSION, seed, inputs, cap);
}

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  const copy = Object.create(Object.getPrototypeOf(value));
  for (const [key, entry] of Object.entries(value)) copy[key] = clone(entry);
  return copy;
}

// This is deliberately an offline, deterministic predictive driver. It proves
// that varied controls can satisfy the referral evidence gate; it is not a
// claim that the controls were human.
function variedPredictiveInputs(seed) {
  const simulation = new RaceToWinSimulation({ seed, trafficVariantCount: 1 });
  simulation.start();
  let snapshot = simulation.snapshot();
  let ticks = 0;
  while (snapshot.state === 'running' && snapshot.simulationTimeMs < 30_000) {
    if (ticks % 12 === 0) {
      let beam = [{ trial: clone(simulation), first: 0, moves: 0 }];
      for (let depth = 0; depth < 7; depth += 1) {
        const next = [];
        for (const node of beam) for (const direction of [0, -1, 1]) {
          const trial = clone(node.trial);
          if (direction && !trial.requestLaneChange(direction)) continue;
          let future = trial.snapshot();
          for (let step = 0; step < 12 && future.state === 'running'; step += 1) future = trial.step(config.fixedStepMs);
          if (future.state === 'running') next.push({ trial, first: depth === 0 ? direction : node.first, moves: node.moves + Number(direction !== 0) });
        }
        if (!next.length) break;
        next.sort((left, right) => left.moves - right.moves);
        const seen = new Set();
        beam = next.filter((node) => {
          const player = node.trial.snapshot().player;
          const key = `${node.first}:${player.targetLaneIndex}:${player.laneX.toFixed(2)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 12);
      }
      if (beam[0]?.first) simulation.requestLaneChange(beam[0].first);
    }
    snapshot = simulation.step(config.fixedStepMs);
    ticks += 1;
  }
  while (snapshot.state === 'running') snapshot = simulation.step(config.fixedStepMs);
  return simulation.runRecord().inputs;
}

test('zero-input automatic crash stays a valid replay but earns no referral evidence', () => {
  const candidate = replay(1, []);
  const baseline = replay(1, [], candidate.elapsedMs);
  assert.equal(candidate.state, 'crashed');
  assert.ok(candidate.score >= 0);
  assert.equal(hasMeaningfulReferralEvidence(candidate, baseline), false);
});

test('repetitive and alternating automated controls do not pass from input count alone', () => {
  const baseline = replay(1, []);
  const repeated = Array.from({ length: 16 }, (_, index) => ({
    sequence: index,
    atMs: 300 + index * 500,
    direction: 1,
  }));
  const alternating = Array.from({ length: 20 }, (_, index) => ({
    sequence: index,
    atMs: 300 + index * 500,
    direction: index % 2 ? -1 : 1,
  }));
  const repeatedProgress = replay(1, repeated);
  const alternatingProgress = replay(1, alternating);

  assert.ok(repeatedProgress.score > baseline.score, 'repetitive control changes the score in this seed');
  assert.equal(repeatedProgress.completedLaneChangeCount, 1);
  assert.equal(hasMeaningfulReferralEvidence(repeatedProgress, baseline), false);
  assert.equal(alternatingProgress.score, baseline.score);
  assert.equal(alternatingProgress.distinctLaneCount, 2);
  assert.equal(hasMeaningfulReferralEvidence(alternatingProgress, baseline), false);
});

test('valid but non-impactful control and impossible-time evidence are ineligible', () => {
  const baseline = replay(1, []);
  const insignificant = replay(1, [{ sequence: 0, atMs: 300, direction: -1 }]);
  assert.equal(insignificant.state, 'crashed');
  assert.equal(insignificant.elapsedMs, baseline.elapsedMs);
  assert.equal(hasMeaningfulReferralEvidence(insignificant, baseline), false);
  assert.equal(replay(1, [{ sequence: 0, atMs: 120_000, direction: 1 }], 10_000), null);
});

test('a deterministic varied input script can pass the replay evidence gate; it is not human attestation', () => {
  for (const seed of [1, 2, 3]) {
    const candidate = replay(seed, variedPredictiveInputs(seed));
    const baseline = replay(seed, [], candidate.elapsedMs);
    assert.equal(candidate.state, 'crashed');
    assert.ok(candidate.score > baseline.score);
    assert.ok(candidate.completedLaneChangeCount >= 4);
    assert.equal(candidate.distinctLaneCount, 3);
    assert.ok(candidate.directionChanges >= 2);
    assert.ok(candidate.distinctTimingIntervalCount >= 2);
    assert.equal(hasMeaningfulReferralEvidence(candidate, baseline), true);
  }
});

test('referral eligibility is server-derived, immutable and does not gate score validity', () => {
  assert.match(finalizeRoute, /hasMeaningfulReferralEvidence\(replay, noInputBaseline\)/);
  assert.match(finalizeRoute, /p_referral_eligible: referralEligible/);
  assert.match(finalizeRoute, /keys\.length < 2 \|\| keys\.length > 3/);
  assert.match(finalizeRoute, /key !== "sessionId" && key !== "inputs" && key !== "telemetry"/);
  assert.doesNotMatch(finalizeRoute, /body\.referralEligible|body\.referral_eligible/);

  assert.match(evidenceMigration, /game_sessions\s+add column referral_eligible boolean not null default false/);
  assert.match(evidenceMigration, /validated_runs\s+add column referral_eligible boolean not null default true/);
  assert.match(evidenceMigration, /new\.referral_eligible := v_session\.referral_eligible/);
  assert.match(evidenceMigration, /new\.referral_eligible is distinct from old\.referral_eligible/);
  assert.match(evidenceMigration, /run\.eligibility_status = 'valid'\s+and run\.referral_eligible/);
  assert.match(evidenceMigration, /p_referral_eligible boolean/);
  assert.match(evidenceMigration, /referral_eligible = p_referral_eligible/);
  assert.match(evidenceMigration, /revoke all on function public\.rtw_finalize_game_session_with_checkpoints[\s\S]*from public, anon, authenticated/);
  assert.match(evidenceMigration, /grant execute on function public\.rtw_finalize_game_session_with_checkpoints[\s\S]*to service_role/);
  assert.doesNotMatch(evidenceMigration, /public\.(?:daily_top_scores|weekly_tournament_totals|provisional_winners|prize_ledger_entries|prize_balances|payouts)/i);
});
