// TEST-only RPC races. Setup/cleanup SQL are reviewed separately; no privilege widening.
import assert from 'node:assert/strict';
import https from 'node:https';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const official = 'c:\\users\\crist\\documents\\codex\\race2win-readiness-20261010';
const project = 'lndvnufmbuzdbinapvze';
if (root.toLowerCase() !== official) throw new Error('Official folder required.');
if (execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim() !== 'fix/production-readiness-20261010') throw new Error('Official branch required.');
const mode = process.argv[2] ?? '--check';
if (!['--prepare', '--check', '--execute'].includes(mode)) throw new Error('Use --prepare, --check or --execute.');
if (mode === '--execute' && process.env.RTW_TEST_FREE_QUOTA_CONFIRMED !== 'true') {
  console.log('BLOCKED: confirm no additional charges before executing hosted races. No requests sent.'); process.exit(2);
}
nextEnv.loadEnvConfig(root, true, { info() {}, error() {} });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url !== `https://${project}.supabase.co` || !key) throw new Error('Existing TEST credentials required.');
if (!key.startsWith('sb_secret_')) {
  let claims;
  try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); } catch { throw new Error('Invalid credential format.'); }
  if (claims.ref !== project || claims.role !== 'service_role') throw new Error('Wrong credential scope.');
}
const files = name => resolve(root, 'supabase/verification', `concurrency-api-${name}`);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const digest = inputs => createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
const nativeRequire = createRequire(import.meta.url), cache = new Map();
function load(path) {
  path = resolve(root, path);
  if (cache.has(path)) return cache.get(path).exports;
  const compiled = { exports: {} }; cache.set(path, compiled);
  const js = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'module', 'require', js)(compiled.exports, compiled, name => name.startsWith('.') ? load(resolve(dirname(path), `${name}.ts`)) : nativeRequire(name));
  return compiled.exports;
}
const { replayAuthoritativeRace } = load('lib/game/race-to-win/authoritative-replay.ts');
if (mode === '--prepare') {
  if (existsSync(files('manifest.json'))) throw new Error('Manifest already exists; preserve it until exact cleanup is confirmed.');
  const manifest = { project, runId: randomUUID(), players: [randomUUID(), randomUUID()], gameId: 'd74fbfee-cbef-4f14-b030-a8bb905d1810', day: '2099-02-09T16:00:00Z', sessions: [] };
  for (let i = 0; i < 15; i++) {
    const seed = i + 1, inputs = [];
    const outcome = replayAuthoritativeRace('rtw-v7', seed, inputs, 600000);
    assert.ok(outcome);
    manifest.sessions.push({ id: randomUUID(), player: manifest.players[i < 10 ? 0 : 1], seed, inputs, outcome });
  }
  const quotedIds = values => values.map(value => `'${value}'`).join(',');
  const players = quotedIds(manifest.players), ids = quotedIds(manifest.sessions.map(item => item.id));
  let setup = `-- TEST lndvnufmbuzdbinapvze only. No email, rewards or payments.\nbegin;\n` +
    `do $$ begin if exists(select 1 from public.validated_runs where tournament_week_start=private.ny_tournament_week_start('${manifest.day}')) or exists(select 1 from public.provisional_winners where tournament_week_start=private.ny_tournament_week_start('${manifest.day}')) then raise exception 'Isolated week is not empty'; end if; end $$;\n` +
    manifest.players.map(id => `insert into auth.users(id,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values('${id}',now(),'{"rtw_concurrency_api":"${manifest.runId}"}','{}');`).join('\n') + '\n' +
    manifest.sessions.map(item => `insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at) values('${item.id}','${item.player}','${manifest.gameId}','rtw-v7',${item.seed},'${manifest.day}','${manifest.day}'::timestamptz+interval '10 minutes',1000,now()+interval '6 minutes');`).join('\n') + '\ncommit;\n';
  let cleanup = `-- Exact run ${manifest.runId}, TEST only. Never broaden these predicates.\nbegin;\n` +
    `do $$ begin if (select count(*) from auth.users where id in (${players}) and raw_app_meta_data->>'rtw_concurrency_api'='${manifest.runId}')<>2 then raise exception 'Synthetic ownership marker mismatch'; end if; if exists(select 1 from public.prize_ledger_entries where player_id in (${players})) or exists(select 1 from public.prize_balances where player_id in (${players})) or exists(select 1 from public.provisional_winners where player_id in (${players})) or exists(select 1 from public.payouts where player_id in (${players})) then raise exception 'Unexpected finance; stop cleanup'; end if; if exists(select 1 from public.game_sessions where user_id in (${players}) and id not in (${ids})) then raise exception 'Unregistered session'; end if; if exists(select 1 from public.validated_runs where tournament_week_start=private.ny_tournament_week_start('${manifest.day}') and player_id not in (${players})) then raise exception 'Foreign isolated-week data'; end if; end $$;\n` +
    `delete from public.daily_top_scores where player_id in (${players});\ndelete from public.validated_runs where player_id in (${players}) and game_session_id in (${ids});\ndelete from private.game_session_checkpoints where game_session_id in (${ids}) and player_id in (${players});\ndelete from public.game_sessions where id in (${ids}) and user_id in (${players});\ndelete from public.weekly_tournament_totals where player_id in (${players});\ndelete from private.competition_action_rate_limits where player_id in (${players});\ndelete from auth.users where id in (${players}) and raw_app_meta_data->>'rtw_concurrency_api'='${manifest.runId}';\ncommit;\n`;
  setup = setup.replace("then raise exception 'Isolated week is not empty'", `or exists(select 1 from public.daily_top_scores where tournament_week_start=private.ny_tournament_week_start('${manifest.day}')) or exists(select 1 from public.weekly_tournament_totals where tournament_week_start=private.ny_tournament_week_start('${manifest.day}')) then raise exception 'Isolated week is not empty'`);
  const remains = [
    `auth.users where id in (${players})`, `public.game_sessions where id in (${ids})`,
    `public.validated_runs where player_id in (${players})`, `public.daily_top_scores where player_id in (${players})`,
    `public.weekly_tournament_totals where player_id in (${players})`,
    `private.game_session_checkpoints where game_session_id in (${ids})`,
    `private.competition_action_rate_limits where player_id in (${players})`,
  ].map(clause => `exists(select 1 from ${clause})`).join(' or ');
  cleanup = cleanup.replace('commit;\n', `do $$ begin if ${remains} then raise exception 'Synthetic cleanup incomplete; transaction aborted'; end if; end $$;\ncommit;\n`);
  writeFileSync(files('manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(files('setup.sql'), setup); writeFileSync(files('cleanup.sql'), cleanup);
  console.log('Prepared synthetic manifest, setup SQL and exact cleanup SQL. No hosted writes.'); process.exit(0);
}
const allowedRPC = new Set(['rtw_finalize_game_session_with_checkpoints', 'rtw_record_game_session_checkpoint_with_lease', 'rtw_read_game_session_checkpoint_proofs', 'rtw_consume_competition_action_rate_limit']);
async function request(path, body, publicOnly = false) {
  assert.ok(path.startsWith('/rest/v1/') || path.startsWith('/auth/v1/admin/users/'));
  const credential = publicOnly ? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY : key;
  assert.ok(credential);
  const started = Date.now(), agent = new https.Agent({ keepAlive: false, rejectUnauthorized: true });
  return new Promise(resolveRequest => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(`${url}${path}`, { method: payload ? 'POST' : 'GET', agent,
      headers: { apikey: credential, Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, res => {
      let text = ''; res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; if (text.length > 262144) req.destroy(); });
      res.on('end', () => { agent.destroy(); let data; try { data = JSON.parse(text); } catch { data = null; }
        resolveRequest({ status: res.statusCode, data, started, finished: Date.now() }); });
      res.on('error', () => { agent.destroy(); resolveRequest({ status: 0, code: 'TRANSPORT_UNAVAILABLE' }); });
    });
    req.setTimeout(10000, () => req.destroy());
    req.on('error', () => { agent.destroy(); resolveRequest({ status: 0, code: 'TRANSPORT_UNAVAILABLE' }); });
    req.end(payload);
  });
}
const preflight = await request('/rest/v1/game_sessions?select=id&limit=0');
if (preflight.status !== 200) {
  console.log(JSON.stringify({ status: 'BLOCKED_BEFORE_WRITES', http: preflight.status, reason: preflight.status ? 'API_ACCESS_REJECTED' : 'TRANSPORT_UNAVAILABLE' })); process.exit(2);
}
if (mode === '--check') { console.log('TEST API preflight passed. No writes; setup/cleanup must be reviewed separately.'); process.exit(0); }
const manifest = JSON.parse(readFileSync(files('manifest.json'), 'utf8'));
assert.equal(manifest.project, project); assert.ok(uuid(manifest.runId)); assert.equal(manifest.day, '2099-02-09T16:00:00Z');
assert.equal(manifest.gameId, 'd74fbfee-cbef-4f14-b030-a8bb905d1810');
assert.equal(manifest.players.length, 2); assert.equal(new Set(manifest.players).size, 2);
assert.ok(manifest.players.every(uuid)); assert.equal(manifest.sessions.length, 15);
assert.equal(new Set(manifest.sessions.map(item => item.id)).size, 15);
for (const item of manifest.sessions) { assert.ok(uuid(item.id)); assert.ok(manifest.players.includes(item.player)); assert.deepEqual(item.outcome, replayAuthoritativeRace('rtw-v7', item.seed, item.inputs, 600000)); }
for (const player of manifest.players) {
  const r = await request(`/auth/v1/admin/users/${player}`);
  assert.equal(r.status, 200); assert.equal(r.data.id, player);
  assert.equal(r.data.app_metadata?.rtw_concurrency_api, manifest.runId);
}
const ids = manifest.sessions.map(item => item.id).join(',');
const stored = await request(`/rest/v1/game_sessions?select=id,user_id,game_id,seed,gameplay_version,status,started_at&id=in.(${ids})`);
assert.equal(stored.status, 200); assert.equal(stored.data.length, 15);
for (const item of manifest.sessions) {
  const row = stored.data.find(row => row.id === item.id);
  assert.equal(row.user_id, item.player); assert.equal(row.game_id, manifest.gameId); assert.equal(row.seed, item.seed);
  assert.equal(row.gameplay_version, 'rtw-v7'); assert.equal(row.status, 'active'); assert.equal(Date.parse(row.started_at), Date.parse(manifest.day));
}
const weekDate = new Date(manifest.day);
weekDate.setUTCDate(weekDate.getUTCDate() - ((weekDate.getUTCDay() + 6) % 7));
const week = weekDate.toISOString().slice(0, 10);
const occupants = await request(`/rest/v1/validated_runs?select=player_id&game_id=eq.${manifest.gameId}&tournament_week_start=eq.${week}`);
assert.equal(occupants.status, 200); assert.ok(occupants.data.every(row => manifest.players.includes(row.player_id)));
const report = { project, runId: manifest.runId, status: 'RUNNING', results: [], requests: [], cleanupRequired: true,
  limitations: ['Independent HTTPS requests; database lock overlap is NOT proven', 'Synthetic future timestamps and privileged RPC; not an authenticated HTTP session', 'No prize, reward, balance credit or payment operations'] };
const save = () => writeFileSync(files('results.json'), JSON.stringify(report, null, 2));
const own = id => manifest.sessions.find(item => item.id === id);
let requestNumber = 0;
async function rpc(name, args, publicOnly = false) {
  assert.ok(allowedRPC.has(name)); assert.ok(manifest.players.includes(args.p_player_id));
  if ('p_session_id' in args) { assert.ok(own(args.p_session_id)); assert.equal(own(args.p_session_id).player, args.p_player_id); }
  const number = ++requestNumber;
  const r = await request(`/rest/v1/rpc/${name}`, args, publicOnly);
  report.requests.push({ number, rpc: name, publicOnly, http: r.status, sqlCode: r.data?.code ?? r.code ?? null, started: r.started ?? null, finished: r.finished ?? null }); save();
  assert.notEqual(r.status, 0, 'Transport failure; no automatic retry.'); return r;
}
function final(item, overrides = {}) {
  return { p_session_id: item.id, p_player_id: item.player, p_input_digest: digest(item.inputs), p_input_count: item.inputs.length,
    p_final_score: item.outcome.score, p_final_distance_millimeters: item.outcome.distanceMillimeters,
    p_final_elapsed_ms: item.outcome.elapsedMs, p_final_collision_at_ms: item.outcome.collisionAtMs, p_checkpoint_proofs: [], ...overrides };
}
async function race(label, name, args) {
  const r = await Promise.all(args.map(body => rpc(name, body)));
  const overlap = Math.max(...r.map(item => item.started)) < Math.min(...r.map(item => item.finished));
  report.results.push({ label, http: r.map(item => item.status), sqlCodes: r.map(item => item.data?.code ?? null), transportOverlap: overlap }); save();
  return r;
}
async function financeEmpty() {
  for (const table of ['provisional_winners', 'prize_ledger_entries', 'prize_balances', 'payouts']) {
    const r = await request(`/rest/v1/${table}?select=player_id&player_id=in.(${manifest.players.join(',')})`);
    assert.equal(r.status, 200); assert.deepEqual(r.data, []);
  }
}
try {
  await financeEmpty(); save();
  const one = manifest.sessions[10], contradictory = manifest.sessions[11], limits = manifest.sessions[12], cp = manifest.sessions[13];
  let r = await race('identical FINALIZE', 'rtw_finalize_game_session_with_checkpoints', [final(one), final(one)]);
  assert.equal(r.filter(item => item.status === 200).length, 1); assert.equal(r.find(item => item.status !== 200).data.code, '23514');
  const retry = await rpc('rtw_finalize_game_session_with_checkpoints', final(one)); assert.equal(retry.data.code, '23514');
  r = await race('contradictory trusted-server digest', 'rtw_finalize_game_session_with_checkpoints', [final(contradictory), final(contradictory, { p_input_digest: 'b'.repeat(64) })]);
  assert.equal(r.filter(item => item.status === 200).length, 1); assert.equal(r.find(item => item.status !== 200).data.code, '23514');
  for (const change of [{ p_final_score: -1 }, { p_input_count: 4097 }, { p_final_collision_at_ms: limits.outcome.elapsedMs + 1 }]) {
    const rejected = await rpc('rtw_finalize_game_session_with_checkpoints', final(limits, change)); assert.equal(rejected.data.code, '22023');
  }
  const checkpoint = { p_session_id: cp.id, p_player_id: cp.player, p_checkpoint_index: 1, p_proof_input_digest: digest([]), p_proof_input_count: 0 };
  r = await race('identical synthetic checkpoint', 'rtw_record_game_session_checkpoint_with_lease', [checkpoint, checkpoint]);
  assert.ok(r.every(item => item.status === 200)); assert.equal(r.filter(item => item.data[0].lease_renewed).length, 1);
  const bad = await rpc('rtw_record_game_session_checkpoint_with_lease', { ...checkpoint, p_proof_input_digest: 'c'.repeat(64) }); assert.equal(bad.data.code, '23514');
  const mixed = manifest.sessions[14];
  const mixedProof = [{ checkpointIndex: 1, inputCount: 0, inputDigest: digest([]) }];
  // A privileged DB fixture at milestone 1000, not a replay-approved score.
  const mixedResults = await Promise.all([
    rpc('rtw_record_game_session_checkpoint_with_lease', { ...checkpoint, p_session_id: mixed.id, p_player_id: mixed.player }),
    rpc('rtw_finalize_game_session_with_checkpoints', final(mixed, { p_final_score: 1000, p_checkpoint_proofs: mixedProof })),
  ]);
  assert.equal(mixedResults[1].status, 200);
  assert.ok(mixedResults[0].status === 200 || mixedResults[0].data?.code === '23514');
  const mixedStored = await rpc('rtw_read_game_session_checkpoint_proofs', { p_session_id: mixed.id, p_player_id: mixed.player });
  assert.equal(mixedStored.status, 200); assert.equal(mixedStored.data.length, 1); assert.equal(mixedStored.data[0].proof_input_digest, digest([]));
  report.results.push({ label: 'synthetic checkpoint versus FINALIZE', http: mixedResults.map(item => item.status), sqlCodes: mixedResults.map(item => item.data?.code ?? null), replayApproved: false }); save();
  for (let i = 0; i < 10; i += 2) {
    r = await race(`same-week independent FINALIZE pair ${i / 2 + 1}`, 'rtw_finalize_game_session_with_checkpoints', [final(manifest.sessions[i]), final(manifest.sessions[i + 1])]);
    assert.ok(r.every(item => item.status === 200));
  }
  const player = manifest.players[0];
  const runs = await request(`/rest/v1/validated_runs?select=game_session_id,score&player_id=eq.${player}`);
  assert.equal(runs.status, 200); assert.equal(runs.data.length, 10); assert.equal(new Set(runs.data.map(item => item.game_session_id)).size, 10);
  const scores = manifest.sessions.slice(0, 10).map(item => item.outcome.score).sort((a, b) => b - a);
  const top = await request(`/rest/v1/daily_top_scores?select=score,validated_run_id&player_id=eq.${player}`);
  assert.equal(top.status, 200); assert.equal(top.data.length, 7); assert.equal(new Set(top.data.map(item => item.validated_run_id)).size, 7);
  assert.equal(top.data.reduce((sum, item) => sum + item.score, 0), scores.slice(0, 7).reduce((sum, score) => sum + score, 0));
  const weekly = await request(`/rest/v1/weekly_tournament_totals?select=weekly_total_score,individual_scores&player_id=eq.${player}`);
  assert.equal(weekly.status, 200); assert.equal(weekly.data.length, 1);
  assert.equal(Number(weekly.data[0].weekly_total_score), scores.slice(0, 7).reduce((sum, score) => sum + score, 0)); assert.deepEqual(weekly.data[0].individual_scores, scores);
  const allRuns = await request(`/rest/v1/validated_runs?select=game_session_id&player_id=in.(${manifest.players.join(',')})`);
  assert.equal(allRuns.status, 200); assert.equal(allRuns.data.length, 13); assert.equal(new Set(allRuns.data.map(item => item.game_session_id)).size, 13);
  const denied = await rpc('rtw_finalize_game_session_with_checkpoints', final(limits), true); assert.equal(denied.data.code, '42501');
  const rateResults = [];
  for (let batch = 0; batch < 5; batch++) {
    rateResults.push(...await Promise.all(Array.from({ length: 4 }, () => rpc('rtw_consume_competition_action_rate_limit', { p_player_id: player, p_action: 'game_checkpoint' }))));
  }
  assert.ok(rateResults.every(item => item.status === 200 && typeof item.data === 'boolean'));
  const withinOneMinute = Math.floor(rateResults[0].started / 60000) === Math.floor(rateResults.at(-1).finished / 60000);
  const acceptedRate = rateResults.filter(item => item.data).length;
  if (withinOneMinute) {
    assert.ok(acceptedRate > 0, 'No requests should be fully rejected inside the action window unless the limit is enforced.');
    assert.ok(acceptedRate <= 18, 'Rate-limit window must not exceed the documented per-minute ceiling.');
  }
  report.results.push({ label: '20 synthetic rate requests, max four in flight', accepted: acceptedRate, minuteWindowAssumed: withinOneMinute, limitation: 'Client-clock minute; hosted DB-window alignment is not proven.' });
  await financeEmpty();
  report.results.push({ label: 'Top7, weekly vector, unique runs, public RPC ACL, finance untouched', passed: true });
  report.status = 'API_CASES_PASSED_SQL_CONCURRENCY_UNPROVEN';
} catch (error) {
  report.status = 'FAILED_OR_BLOCKED'; report.error = { code: typeof error.code === 'string' ? error.code : 'CHECK_FAILED' }; process.exitCode = 2;
} finally { save(); }
console.log(JSON.stringify({ status: report.status, rpcRequests: report.requests.length,
  acceptedHttp: report.requests.filter(item => item.http === 200).length,
  rejectedHttp: report.requests.filter(item => item.http >= 400).length,
  resultFile: 'supabase/verification/concurrency-api-results.json', cleanupRequired: true, sqlLockConcurrencyApproved: false }));
