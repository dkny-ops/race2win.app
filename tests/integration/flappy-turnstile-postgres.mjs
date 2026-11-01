// Disposable native PostgreSQL only; never accepts a remote connection.
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
const bin = process.env.PSQL_BIN || 'psql';
const port = '55405';
if (process.env.PGHOST && process.env.PGHOST !== '127.0.0.1') throw Error('Local PostgreSQL only');
if (process.env.PGPORT && process.env.PGPORT !== port) throw Error('Local PostgreSQL only');
const env = {...process.env}; delete env.PGSERVICE; delete env.PGSERVICEFILE;
const db = 'flappy_turnstile_' + Date.now();
const flags = ['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres'];
const sql = (query, database = db) => execFileSync(bin,[...flags,'-d',database,'-c',query],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const file = path => execFileSync(bin,[...flags,'-d',db,'-1','-f',fileURLToPath(new URL(path,root))],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const lit = value => "'" + String(value).replaceAll("'","''") + "'";
const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
let passed = 0;
const pass = text => { console.log('PASS '+text); passed++; };
sql('create database '+db,'postgres');
try {
 file('supabase/verification/local-auth-bootstrap.sql');
 sql('alter table auth.users add column email text, add column banned_until timestamptz, add column deleted_at timestamptz');
 // Scheduler registration is outside this test; all application SQL still runs on native PG.
 sql(`create schema cron; create table cron.job(jobname text); create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint'`);
 const fingerprint=()=>sql("select md5(string_agg(pg_get_functiondef(p.oid),'|' order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname not like 'flappy_turnstile_%'");
 let before;
 for (const name of readdirSync(new URL('supabase/migrations/',root)).filter(n=>/^\d+_.+\.sql$/.test(n)).sort()) {
   // Financial support history is independent and has missing remote-only predecessors.
   if(name > '20261026180259_competitive_identity_evidence.sql' && name !== '20261101205957_flappy_invisible_midrun.sql') continue;
   // This historical one-off activation requires the real owner and empty production data.
   if(name==='20261026042207_flappy_activate_reviewed_nonfinancial_competition.sql') continue;
   if(name==='20261101205957_flappy_invisible_midrun.sql') before=fingerprint();
   try { file('supabase/migrations/'+name); } catch (e) { console.error('Migration failed: '+name); throw e; }
 }
 assert.equal(fingerprint(),before);pass('all existing application function definitions remain unchanged');
 pass('migration applies to real PostgreSQL with the authoritative Flappy and identity schema');
 assert.equal(sql('select enabled from private.flappy_turnstile_control'),'f');
 sql(`insert into auth.users(id,email,email_confirmed_at) values('${a}','a@example.invalid',now()),('${b}','b@example.invalid',now());`);
 const game=sql("select id from public.games where slug='flappy-race'");
 assert.ok(game);
 // CHECK requires exact timestamp interval, so use one statement timestamp for fixtures.
 const fixture = (player=a) => sql(`with t as(select clock_timestamp() t) insert into private.flappy_sessions(player_id,game_id,version,seed,starts_at,expires_at,lease_until)
 select '${player}','${game}','flappy-v1',1,t,t+interval '10 minutes',t+interval '15 seconds' from t returning id`);
 const legacy=fixture();
 assert.equal(sql(`select count(*) from private.flappy_turnstile_checks where session_id='${legacy}'`),'0');
 sql(`update private.flappy_sessions set status='expired' where id='${legacy}'; update private.flappy_turnstile_control set enabled=true`);
 const id=fixture(), other=fixture(b);
 const status = (player=a, sid=id) => JSON.parse(sql(`set role service_role; select public.flappy_turnstile_status('${player}','${sid}')`));
 let s=status(); assert.equal(s.required,true); assert.equal(s.due,false); assert.equal(s.nonce,null);
 const interval=Number(sql(`select extract(epoch from(c.next_due_at-s.starts_at)) from private.flappy_turnstile_checks c join private.flappy_sessions s on s.id=c.session_id where s.id='${id}'`));
 assert.ok(interval>=15&&interval<=35);pass('new sessions get a server-selected random deadline; legacy sessions are unchanged');
 for (const role of ['anon','authenticated','service_role']) {
   for (const table of ['flappy_turnstile_control','flappy_turnstile_checks']) assert.equal(sql(`select has_table_privilege('${role}','private.${table}','SELECT,INSERT,UPDATE,DELETE')`),'f');
   if(role!=='service_role') for (const name of ['flappy_turnstile_enabled()','flappy_turnstile_status(uuid,uuid)','flappy_turnstile_verify(uuid,uuid,uuid)']) assert.equal(sql(`select has_function_privilege('${role}','public.${name}','EXECUTE')`),'f');
 }
 assert.equal(sql("select count(*) from pg_class where relname in('flappy_turnstile_control','flappy_turnstile_checks') and relrowsecurity"),'2');
 sql('grant usage on schema private to authenticated; grant select on private.flappy_turnstile_control,private.flappy_turnstile_checks to authenticated');
 assert.equal(sql('set role authenticated; select count(*) from private.flappy_turnstile_checks'),'0');
 assert.equal(sql('set role authenticated; select count(*) from private.flappy_turnstile_control'),'0');
 sql('revoke select on private.flappy_turnstile_control,private.flappy_turnstile_checks from authenticated; revoke usage on schema private from authenticated');
 assert.throws(()=>status(b));pass('RLS, least privilege and cross-player ownership enforced');
 const early=sql(`select nonce from private.flappy_turnstile_checks where session_id='${id}'`);
 const verify=(nonce,player=a,sid=id)=>sql(`set role service_role; select public.flappy_turnstile_verify('${player}','${sid}','${nonce}')`);
 assert.throws(()=>verify(early));
 sql(`update private.flappy_turnstile_checks set next_due_at=clock_timestamp()-interval '1 second' where session_id='${id}'`);
 s=status();assert.equal(s.due,true);assert.equal(s.nonce,early);
 assert.throws(()=>verify('33333333-3333-4333-8333-333333333333'));
 assert.throws(()=>verify(early,b,other));
 const args=[...flags,'-d',db,'-c',`set role service_role; select public.flappy_turnstile_verify('${a}','${id}','${early}')`];
 const results=await Promise.allSettled([promisify(execFile)(bin,args,{env}),promisify(execFile)(bin,args,{env})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(sql(`select verified_count from private.flappy_turnstile_checks where session_id='${id}'`),'1');
 assert.throws(()=>verify(early));pass('early, wrong and concurrent/replayed nonces cannot grant repeated verification');
 const next=status(); assert.equal(next.due,false); assert.notEqual(sql(`select nonce from private.flappy_turnstile_checks where session_id='${id}'`),early);
 const gap=Number(sql(`select extract(epoch from(next_due_at-last_verified_at)) from private.flappy_turnstile_checks where session_id='${id}'`));assert.ok(gap>=20&&gap<=45);
 sql(`update private.flappy_turnstile_checks set next_due_at=clock_timestamp()-interval '31 seconds' where session_id='${id}'`);
 assert.throws(()=>verify(status().nonce));pass('next deadline randomized and stale challenges rejected');
 const insert = (sid,player,completed) => sql(`with t as(select ${completed} completed) insert into private.flappy_runs(session_id,player_id,game_id,score,collision_tick,completed_at,tournament_day,tournament_week_start)
 select '${sid}','${player}','${game}',0,40,completed,(completed at time zone 'America/New_York')::date,date_trunc('week',completed at time zone 'America/New_York')::date from t`);
 assert.throws(()=>insert(id,a,'clock_timestamp()'));
 assert.equal(sql(`select count(*) from private.flappy_runs where session_id='${id}'`),'0');
 insert(other,b,'clock_timestamp()');pass('finalization blocks bypassed checks but accepts collisions before the first deadline');
 sql(`update private.flappy_sessions set lease_until=clock_timestamp()-interval '1 second' where id='${id}'`);
 assert.throws(()=>status());pass('expired activity leases cannot verify');
 console.log(`${passed} PostgreSQL checks passed`);
} catch(error) { console.error(error.stderr?.toString()||error); throw error; }
finally { sql('drop database '+db+' with(force)','postgres'); }
