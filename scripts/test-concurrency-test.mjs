// Opt-in hosted TEST only. No email, awards, balance credits or payouts.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ref = 'lndvnufmbuzdbinapvze';
const mode = process.argv.includes('--execute');
if (root.toLowerCase() !== 'c:\\users\\crist\\documents\\codex\\race2win-readiness-20261010') throw new Error('Official folder required.');
if (execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim() !== 'fix/production-readiness-20261010') throw new Error('Official branch required.');
nextEnv.loadEnvConfig(root, true, { info() {}, error() {} });
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co`) throw new Error('TEST only.');
if (!mode) { console.log('Prepared only. Use --execute with a private TEST session-pooler connection and the pg driver.'); process.exit(0); }
const raw = process.env.RTW_TEST_DATABASE_URL;
if (!raw) { console.log('BLOCKED: privately configure RTW_TEST_DATABASE_URL. No fixtures created.'); process.exit(2); }
let connection;
try { connection = new URL(raw); } catch { throw new Error('Invalid TEST connection format.'); }
// Reject Production, alternate hosts/projects, non-TLS and transaction pooler.
if (!['postgres:', 'postgresql:'].includes(connection.protocol)
  || connection.search || connection.hash
  || !connection.password
  || !((connection.hostname === `db.${ref}.supabase.co` && decodeURIComponent(connection.username) === 'postgres')
    || (connection.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(connection.username) === `postgres.${ref}`))
  || (connection.port && connection.port !== '5432')) throw new Error('Use the TEST direct/session pooler URL, port 5432, without URL query parameters.');
let Client;
try { ({ Client } = await import('pg')); } catch { console.log('BLOCKED: pg driver unavailable. No fixtures created.'); process.exit(2); }
const clients = [];
const users = [randomUUID(), randomUUID()];
const sessions = [];
const results = [];
const day = '2099-01-05T16:00:00Z';
const digest = 'a'.repeat(64);
let setup = false, coordinator;
async function connect() {
  const client = new Client({
    host: connection.hostname, port: 5432, database: 'postgres',
    user: decodeURIComponent(connection.username), password: decodeURIComponent(connection.password),
    ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000,
    application_name: 'rtw-synthetic-concurrency',
  });
  await client.connect(); clients.push(client);
  await client.query("set statement_timeout='15s'; set lock_timeout='10s'");
  return client;
}
async function begin(client, role = 'service_role') { await client.query('begin'); await client.query(`set local role ${role}`); }
async function settle(client, sql, args) {
  try { const value = await client.query(sql, args); return { ok: true, rows: value.rows }; }
  catch (error) { return { ok: false, code: error.code }; }
}
async function blocked(pid, holder) {
  for (let i = 0; i < 25; i++) {
    const { rows } = await coordinator.query('select $2::integer = any(pg_blocking_pids($1)) blocked', [pid, holder]);
    if (rows[0].blocked) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error('Real lock overlap not observed; do not report a concurrent pass.');
}
const finalSQL = 'select * from public.rtw_finalize_game_session_with_checkpoints($1,$2,$3,0,$4,100000,1000,1000,$5::jsonb)';
const cpSQL = 'select * from public.rtw_record_game_session_checkpoint_with_lease($1,$2,1,$3,0)';
const finalArgs = (id, player, score, hash = digest, proofs = []) => [id, player, hash, score, JSON.stringify(proofs)];
async function session(player) {
  const id = randomUUID(); sessions.push(id);
  await coordinator.query(`insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at)
    select $1,$2,id,'rtw-v7',42,$3::timestamptz,$3::timestamptz+interval '10 minutes',1000,now()+interval '1 minute'
    from public.games where slug='race-to-win'`, [id, player, day]);
  return id;
}
try {
  coordinator = await connect(); const a = await connect(), b = await connect();
  const aPid = (await a.query('select pg_backend_pid() pid')).rows[0].pid;
  const bPid = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
  assert.notEqual(aPid, bPid);
  const { rows: baseline } = await coordinator.query(`select
    (select count(*) from public.validated_runs where tournament_week_start=private.ny_tournament_week_start($1)) runs,
    (select count(*) from public.provisional_winners where tournament_week_start=private.ny_tournament_week_start($1)) winners`, [day]);
  assert.equal(Number(baseline[0].runs), 0); assert.equal(Number(baseline[0].winners), 0);
  await coordinator.query('begin');
  for (const id of users) await coordinator.query("insert into auth.users(id,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values($1,now(),'{\"rtw_synthetic_concurrency\":true}', '{}')", [id]);
  await coordinator.query('commit'); setup = true;

  async function race(label, holderSQL, holderArgs, contenderSQL, contenderArgs, expectedCode, prelock) {
    await begin(a); await begin(b);
    if (prelock) await a.query('select id from public.game_sessions where id=$1 for update', [prelock]);
    const holder = prelock ? null : await settle(a, holderSQL, holderArgs);
    if (holder) assert.equal(holder.ok, true);
    const pending = settle(b, contenderSQL, contenderArgs);
    await blocked(bPid, aPid);
    const outcomeA = holder ?? await settle(a, holderSQL, holderArgs);
    assert.equal(outcomeA.ok, true);
    await a.query('commit');
    const outcomeB = await pending;
    await b.query(outcomeB.ok ? 'commit' : 'rollback');
    if (expectedCode) { assert.equal(outcomeB.ok, false); assert.equal(outcomeB.code, expectedCode); }
    else assert.equal(outcomeB.ok, true);
    results.push({ test: label, passed: true, holderPid: aPid, contenderPid: bPid, lockOverlapObserved: true });
    return [outcomeA, outcomeB];
  }
  const identical = await session(users[1]);
  await race('identical FINALIZE: one durable outcome', finalSQL, finalArgs(identical, users[1], 100), finalSQL, finalArgs(identical, users[1], 100), '23514', identical);
  await begin(b); assert.equal((await settle(b, finalSQL, finalArgs(identical, users[1], 100))).code, '23514'); await b.query('rollback');
  const conflicting = await session(users[1]);
  await race('contradictory FINALIZE: loser rejected', finalSQL, finalArgs(conflicting, users[1], 100), finalSQL, finalArgs(conflicting, users[1], 900, 'b'.repeat(64)), '23514', conflicting);
  const cp = await session(users[1]);
  const checkpoints = await race('identical checkpoints: no duplicate or second renewal', cpSQL, [cp, users[1], digest], cpSQL, [cp, users[1], digest], null, cp);
  assert.equal(checkpoints[1].rows[0].lease_renewed, false);
  await race('contradictory checkpoint: immutable proof', cpSQL, [cp, users[1], digest], cpSQL, [cp, users[1], 'b'.repeat(64)], '23514', cp);
  const proofs = [{ checkpointIndex: 1, inputCount: 0, inputDigest: digest }];
  await race('checkpoint versus FINALIZE: consistent proof', cpSQL, [cp, users[1], digest], finalSQL, finalArgs(cp, users[1], 1000, digest, proofs), null, cp);
  const reverse = await session(users[1]);
  await race('FINALIZE versus checkpoint: completed session immutable', finalSQL, finalArgs(reverse, users[1], 1000), cpSQL, [reverse, users[1], digest], '23514', reverse);

  for (let i = 1; i <= 10; i += 2) {
    const first = await session(users[0]), second = await session(users[0]);
    await race(`weekly advisory lock pair ${i}`, finalSQL, finalArgs(first, users[0], i * 10), finalSQL, finalArgs(second, users[0], (i + 1) * 10));
  }
  const summary = (await coordinator.query(`select
    (select count(*) from public.validated_runs where player_id=$1) runs,
    (select count(*) from public.daily_top_scores where player_id=$1) top7,
    (select weekly_total_score from public.weekly_tournament_totals where player_id=$1) weekly,
    (select cardinality(individual_scores) from public.weekly_tournament_totals where player_id=$1) vector,
    (select count(*) from public.validated_runs where game_session_id=$2) deduplicated`, [users[0], identical])).rows[0];
  assert.equal(Number(summary.runs), 10); assert.equal(Number(summary.top7), 7);
  assert.equal(Number(summary.weekly), 490); assert.equal(summary.vector, 10); assert.equal(Number(summary.deduplicated), 1);
  results.push({ test: 'Top7=490, complete weekly tie vector, one run per session', passed: true });
  await begin(b); assert.equal((await settle(b, finalSQL, finalArgs(conflicting, users[0], 100))).code, 'P0002'); await b.query('rollback');
  for (const role of ['anon', 'authenticated']) {
    await begin(b, role);
    assert.equal((await settle(b, finalSQL, finalArgs(conflicting, users[1], 100))).code, '42501');
    await b.query('rollback'); await begin(b, role);
    assert.equal((await settle(b, 'select count(*) from public.validated_runs', [])).code, '42501'); await b.query('rollback');
  }
  const finance = (await coordinator.query(`select
    (select count(*) from public.prize_ledger_entries where player_id=any($1::uuid[])) ledger,
    (select count(*) from public.prize_balances where player_id=any($1::uuid[])) balances,
    (select count(*) from public.provisional_winners where player_id=any($1::uuid[])) winners,
    (select count(*) from public.payouts where player_id=any($1::uuid[])) payouts`, [users])).rows[0];
  for (const count of Object.values(finance)) assert.equal(Number(count), 0);
  results.push({ test: 'foreign ownership and browser ACL denied; synthetic finance untouched', passed: true });
} catch (error) {
  console.log(JSON.stringify({ status: 'FAILED_OR_BLOCKED', code: typeof error.code === 'string' ? error.code : 'CHECK_FAILED', fixtureUserIds: setup ? users : [], fixtureSessionIds: setup ? sessions : [] }));
  process.exitCode = 2; // Never print connection strings or raw provider errors.
} finally {
  for (const client of clients) { try { await client.query('rollback'); } catch {} }
  if (setup && coordinator) {
    try {
      await coordinator.query('begin');
      // Exact synthetic IDs only; refuse cleanup if finance was unexpectedly created.
      const { rows } = await coordinator.query('select count(*) n from public.prize_ledger_entries where player_id=any($1::uuid[])', [users]);
      assert.equal(Number(rows[0].n), 0);
      await coordinator.query('delete from public.daily_top_scores where player_id=any($1::uuid[])', [users]);
      await coordinator.query('delete from public.validated_runs where player_id=any($1::uuid[])', [users]);
      await coordinator.query('delete from private.game_session_checkpoints where game_session_id=any($1::uuid[])', [sessions]);
      await coordinator.query('delete from public.game_sessions where id=any($1::uuid[]) and user_id=any($2::uuid[])', [sessions, users]);
      await coordinator.query('delete from public.weekly_tournament_totals where player_id=any($1::uuid[])', [users]);
      await coordinator.query("delete from auth.users where id=any($1::uuid[]) and raw_app_meta_data->>'rtw_synthetic_concurrency'='true'", [users]);
      await coordinator.query('commit'); results.push({ test: 'exact synthetic fixture cleanup', passed: true });
    } catch { try { await coordinator.query('rollback'); } catch {} console.log(JSON.stringify({ status: 'CLEANUP_PENDING', fixtureUserIds: users, fixtureSessionIds: sessions })); process.exitCode = 2; }
  }
  await Promise.allSettled(clients.map(client => client.end()));
}
console.log(JSON.stringify({ status: process.exitCode ? 'NOT_APPROVED' : 'PASS', results,
  limitations: ['Trusted SQL fixture evidence, not authenticated HTTP replay', 'No reward generation, ledger-credit, balance-credit or payment concurrency tested', 'Forced overlapping interleavings, not a load test'] }, null, 2));
