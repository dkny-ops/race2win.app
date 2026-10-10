// No network or connection string: both databases exist only in local WASM memory.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { verifyLocalApi } from './local-api-behavior.mjs';

const root = new URL('../../', import.meta.url);
const migrations = (await readdir(new URL('supabase/migrations/', root))).filter(x => /^\d{14}_.+\.sql$/.test(x)).sort();
const manifest = [];
for (const file of migrations) {
  const sql = await readFile(new URL(`supabase/migrations/${file}`, root), 'utf8');
  manifest.push({ file, version: file.slice(0, 14), sha256: createHash('sha256').update(sql).digest('hex'), sql });
}
const results = [];
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text);
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to service_role;`);
  return db;
}
async function apply(db, migration, fail = false) {
  await db.transaction(async tx => {
    await tx.exec(migration.sql);
    if (fail) throw new Error('controlled migration failure');
    await tx.query('insert into supabase_migrations.schema_migrations values($1,$2)', [migration.version, migration.file]);
  });
}
async function count(db, table) { return Number((await db.query(`select count(*) n from ${table}`)).rows[0].n); }
const fresh = await setup();
for (const migration of manifest) await apply(fresh, migration);
assert.equal(await count(fresh, 'supabase_migrations.schema_migrations'), manifest.length);
results.push(`PASS fresh install ${manifest.length} migrations`);
await fresh.close();

const db = await setup();
for (const migration of manifest.slice(0, 9)) await apply(db, migration);
await db.exec(await readFile(new URL('supabase/verification/local-baseline.sql', root), 'utf8'));
const baseline = (await db.query('select id,status,final_score from public.game_sessions order by id')).rows;
const preservedTables = ['profiles','games','validated_runs','daily_top_scores','weekly_tournament_totals'];
const preserved = {};
for (const table of preservedTables) preserved[table] = (await db.query(`select to_jsonb(row) payload from public.${table} row order by to_jsonb(row)::text`)).rows;
const financialTables = ['provisional_winners','prize_ledger_entries','prize_balances','payouts'];
for (const table of financialTables) assert.equal(await count(db, `public.${table}`), 0);
await assert.rejects(apply(db, manifest[9], true), /controlled migration failure/);
assert.equal(await count(db, 'supabase_migrations.schema_migrations'), 9);
assert.equal((await db.query("select to_regclass('private.game_session_checkpoints') object")).rows[0].object, null);
assert.deepEqual((await db.query('select id,status,final_score from public.game_sessions order by id')).rows, baseline);
results.push('PASS injected failure rolls back DDL/history/data; retry succeeds');
for (const migration of manifest.slice(9)) {
  if (migration === manifest.at(-1)) {
    const countBefore = await count(db, 'supabase_migrations.schema_migrations');
    await assert.rejects(apply(db, migration, true), /controlled migration failure/);
    assert.equal(await count(db, 'supabase_migrations.schema_migrations'), countBefore);
    results.push('PASS late failure preserves earlier committed migrations; final retry succeeds');
  }
  await apply(db, migration);
}
assert.deepEqual((await db.query('select id,status,final_score from public.game_sessions order by id')).rows, baseline);
for (const table of preservedTables) assert.deepEqual((await db.query(`select to_jsonb(row) payload from public.${table} row order by to_jsonb(row)::text`)).rows, preserved[table]);
results.push('PASS upgrade preserves existing active/finalized v6 sessions and profile');
try {
  await db.exec(await readFile(new URL('supabase/verification/local-behavior.sql', root), 'utf8'));
} catch (error) {
  await db.close();
  throw new Error(`${error.message} (${error.code}): ${error.where}`, { cause: error });
}
results.push('PASS SQL behavior: FINALIZE/checkpoint/Top7/week/RLS/ACL/OTP');
results.push(await verifyLocalApi(db));
for (const table of financialTables) assert.equal(await count(db, `public.${table}`), 0);
results.push('PASS no awards, payments or balances created');
const version = (await db.query('select version()')).rows[0].version;
await db.close();
console.log(JSON.stringify({ engine: version, results, limitation: 'Single-process PostgreSQL WASM; auth tables/functions are minimal test fixtures. No live Auth/PostgREST or concurrent connection/lock testing.' }, null, 2));
if (process.argv.includes('--write-manifest')) {
  await writeFile(new URL('supabase/verification/production-pending-manifest.json', root), JSON.stringify({ productionProjectRef:'fspszgqmwhwfoiitnerp', sourceBaseRevision:'e170955298847d4d56ff7f5d615627d6a9cb2cd2', baseProductionVersions: manifest.slice(0,9).map(x=>x.version), originalPendingCount:15, pending:manifest.slice(9).map(({sql,...entry})=>entry), productionExecutionAuthorized:false }, null, 2)+'\n');
}
