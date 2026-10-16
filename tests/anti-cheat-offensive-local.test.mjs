import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nativeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function load(path, overrides = {}) {
  path = resolve(root, path);
  if (moduleCache.has(path)) return moduleCache.get(path).exports;
  const compiled = { exports: {} };
  moduleCache.set(path, compiled);
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('exports', 'module', 'require', output)(compiled.exports, compiled, name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === 'server-only') return {};
    return name.startsWith('.') ? load(resolve(dirname(path), `${name}.ts`)) : nativeRequire(name);
  });
  return compiled.exports;
}

const simulationModule = load('lib/game/race-to-win/simulation.ts');
const replayModule = load('lib/game/race-to-win/authoritative-replay.ts');
const configModule = load('lib/game/race-to-win/config.ts');
const inputHelpers = load('lib/game/race-to-win/official-inputs.ts');
const checkpointHelpers = load('lib/game/race-to-win/checkpoints.ts');
const antiAutomation = load('lib/security/anti-automation.ts');
const { RaceToWinSimulation } = simulationModule;
const { GAMEPLAY_VERSION, DEFAULT_RACE_TO_WIN_CONFIG: config } = configModule;

function makeCompletedRun() {
  const simulation = new RaceToWinSimulation({ seed: 1, trafficVariantCount: 6 });
  simulation.start();
  let snapshot = simulation.snapshot();
  while (snapshot.state === 'running') snapshot = simulation.step(config.fixedStepMs);
  const inputs = simulation.runRecord().inputs;
  const outcome = replayModule.replayAuthoritativeRace(GAMEPLAY_VERSION, 1, inputs, snapshot.simulationTimeMs);
  assert.ok(outcome);
  return { inputs, outcome };
}

function makeRoute(state) {
  const captured = { rpc: [], queries: [] };
  const admin = {
    from(table) {
      const query = { table, filters: [] };
      const chain = {
        select() { return chain; },
        eq(column, value) { query.filters.push([column, value]); return chain; },
        async maybeSingle() {
          captured.queries.push(query);
          if (!state.session) return { data: null, error: null };
          const matches = query.filters.every(([column, value]) => state.session[column] === value);
          return { data: matches ? state.session : null, error: null };
        },
      };
      return chain;
    },
    async rpc(name, args) {
      captured.rpc.push({ name, args });
      if (name === 'rtw_read_game_session_checkpoint_proofs') return { data: [], error: null };
      if (state.finalizeError) return { data: null, error: state.finalizeError };
      return { data: [{
        final_score: args.p_final_score,
        final_distance_millimeters: args.p_final_distance_millimeters,
        final_elapsed_ms: args.p_final_elapsed_ms,
        final_collision_at_ms: args.p_final_collision_at_ms,
      }], error: null };
    },
  };
  const stubs = {
    'next/server': { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
    '@/lib/game/race-to-win': replayModule,
    '@/lib/game/race-to-win/checkpoints': checkpointHelpers,
    '@/lib/game/race-to-win/official-inputs': inputHelpers,
    '@/lib/supabase/admin': { createAdminClient: () => admin, isAdminConfigured: () => true },
    '@/lib/supabase/server': { getVerifiedUserContext: async () => state.userId ? { userId: state.userId } : null },
    '@/lib/observability/security-event': { createSecurityRequestId: () => 'local-test', logSecurityEvent() {} },
    '@/lib/security/anti-automation': antiAutomation,
  };
  const routePath = resolve(root, 'app/api/game-sessions/finalize/route.ts');
  moduleCache.delete(routePath);
  const route = load(routePath, stubs);
  return { POST: route.POST, captured };
}

function sessionFor(userId, status = 'active', run = makeCompletedRun()) {
  return {
    id: 'a18f3537-cbd2-4f3f-a9f5-3cc5c8739b0a',
    user_id: userId,
    gameplay_version: GAMEPLAY_VERSION,
    seed: 1,
    status,
    started_at: new Date(Date.now() - 15 * 60_000).toISOString(),
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    activity_lease_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    checkpoint_interval_score: 1000,
    finalized_at: status === 'finalized' ? new Date().toISOString() : null,
    input_digest: status === 'finalized' ? checkpointHelpers.digestOfficialInputs(run.inputs) : null,
    final_score: status === 'finalized' ? run.outcome.score : null,
    final_distance_millimeters: status === 'finalized' ? run.outcome.distanceMillimeters : null,
    final_elapsed_ms: status === 'finalized' ? run.outcome.elapsedMs : null,
    final_collision_at_ms: status === 'finalized' ? run.outcome.collisionAtMs : null,
  };
}

const run = makeCompletedRun();
const owner = 'b16e2ee8-0913-46c5-8810-a9d1789fc870';
const sessionId = 'a18f3537-cbd2-4f3f-a9f5-3cc5c8739b0a';
const payload = (inputs = run.inputs, extras = {}) => ({ sessionId, inputs, ...extras });
const post = (handler, body) => handler(new Request('https://local.test/api/game-sessions/finalize', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

test('forged client metrics and unexpected top-level parameters are rejected before DB access', async () => {
  const { POST, captured } = makeRoute({ userId: owner, session: sessionFor(owner) });
  const forgedClaims = [
    { score: 999_999_999 },
    { score: -1 },
    { score: 1.5 },
    { distanceMillimeters: 1 },
    { distanceMillimeters: -1 },
    { distanceMillimeters: 1.5 },
    { elapsedMs: 1 },
    { elapsedMs: -1 },
    { elapsedMs: 1.5 },
    { collisionAtMs: 0 },
    { collisionAtMs: run.outcome.elapsedMs + 1 },
    { inputDigest: '0'.repeat(64) },
  ];
  for (const claim of forgedClaims) assert.equal((await post(POST, payload(run.inputs, claim))).status, 400);
  assert.equal(captured.queries.length, 0);
  assert.equal(captured.rpc.length, 0);
});

test('final score, distance, elapsed time, collision and digest are derived from the real replay', async () => {
  const { POST, captured } = makeRoute({ userId: owner, session: sessionFor(owner) });
  const response = await post(POST, payload());
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result, {
    score: run.outcome.score,
    distanceMillimeters: run.outcome.distanceMillimeters,
    elapsedMs: run.outcome.elapsedMs,
    collisionAtMs: run.outcome.collisionAtMs,
  });
  const finalize = captured.rpc.find(item => item.name === 'rtw_finalize_game_session_with_checkpoints');
  assert.ok(finalize);
  assert.equal(finalize.args.p_final_score, run.outcome.score);
  assert.equal(finalize.args.p_final_distance_millimeters, run.outcome.distanceMillimeters);
  assert.equal(finalize.args.p_final_elapsed_ms, run.outcome.elapsedMs);
  assert.equal(finalize.args.p_final_collision_at_ms, run.outcome.collisionAtMs);
  assert.equal(finalize.args.p_input_digest, checkpointHelpers.digestOfficialInputs(run.inputs));
});

test('optional browser telemetry cannot become a database score, outcome, or eligibility parameter', async () => {
  const { POST, captured } = makeRoute({ userId: owner, session: sessionFor(owner) });
  const telemetry = { version: 1, keyboardEvents: 12, touchEvents: 0, pointerEvents: 0, trustedEvents: 12, untrustedEvents: 0, webdriverReported: false };
  assert.equal((await post(POST, payload(run.inputs, { telemetry }))).status, 200);
  const finalize = captured.rpc.find(item => item.name === 'rtw_finalize_game_session_with_checkpoints');
  assert.ok(finalize);
  assert.equal(Object.hasOwn(finalize.args, 'p_telemetry'), false);
  assert.equal(Object.hasOwn(finalize.args, 'p_risk_status'), false);
  assert.equal(Object.hasOwn(finalize.args, 'p_final_score'), true);
});

test('malformed, reordered, extended and over-limit input evidence is rejected', async () => {
  const { POST, captured } = makeRoute({ userId: owner, session: sessionFor(owner) });
  const maliciousInputs = [
    [{ sequence: 0, atMs: 0, direction: 0 }],
    [{ sequence: 1, atMs: 0, direction: 1 }],
    [{ sequence: 0, atMs: 0, direction: 1, score: 9_999 }],
    Array.from({ length: 4097 }, (_, sequence) => ({ sequence, atMs: 0, direction: 1 })),
  ];
  for (const inputs of maliciousInputs) {
    const response = await post(POST, payload(inputs));
    assert.equal(response.status, 400);
  }
  assert.equal(captured.queries.length, 0);
  assert.equal(captured.rpc.length, 0);
});

test('unauthenticated and cross-player session finalization are denied', async () => {
  const unauthenticated = makeRoute({ userId: null, session: sessionFor(owner) });
  assert.equal((await post(unauthenticated.POST, payload())).status, 401);
  assert.equal(unauthenticated.captured.queries.length, 0);

  const attacker = 'c47ff22b-a232-4a70-b749-261845a91874';
  const spoofed = makeRoute({ userId: attacker, session: sessionFor(owner) });
  assert.equal((await post(spoofed.POST, payload())).status, 404);
  assert.deepEqual(spoofed.captured.queries[0].filters, [['id', sessionId], ['user_id', attacker]]);
  assert.equal(spoofed.captured.rpc.length, 0);
});

test('finalized-session replay is idempotent only for identical input evidence', async () => {
  const exact = makeRoute({ userId: owner, session: sessionFor(owner, 'finalized') });
  assert.equal((await post(exact.POST, payload())).status, 200);
  assert.equal(exact.captured.rpc.length, 0);

  const contradictory = makeRoute({ userId: owner, session: sessionFor(owner, 'finalized') });
  const response = await post(contradictory.POST, payload([{ sequence: 0, atMs: 1, direction: 1 }]));
  assert.equal(response.status, 409);
  assert.equal(contradictory.captured.rpc.length, 0);
});

test('replay refuses fabricated time evidence and unfinished runs cannot FINALIZE', () => {
  assert.equal(replayModule.replayAuthoritativeRace(GAMEPLAY_VERSION, 1, run.inputs, 0), null);
  assert.equal(replayModule.replayAuthoritativeRace('unknown-version', 1, run.inputs, run.outcome.elapsedMs), null);
  assert.equal(replayModule.replayAuthoritativeRace(GAMEPLAY_VERSION, -1, run.inputs, run.outcome.elapsedMs), null);
  const progress = replayModule.replayAuthoritativeProgress(GAMEPLAY_VERSION, 1, [], 0);
  assert.equal(progress.state, 'running');
  assert.equal(replayModule.replayAuthoritativeRace(GAMEPLAY_VERSION, 1, [], 0), null);
});
