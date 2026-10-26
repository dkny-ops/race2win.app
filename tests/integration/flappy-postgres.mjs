// Real PostgreSQL only. Refuses arbitrary/production connection settings.
// Run: node tests/integration/flappy-postgres.mjs
import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";
import { execFileSync,execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import ts from "typescript";
const require=createRequire(import.meta.url), exec=promisify(execFile);
if(process.env.PGHOST&&process.env.PGHOST!=="127.0.0.1")throw Error("Isolated PG only");
if(process.env.PGPORT&&process.env.PGPORT!=="55439")throw Error("Isolated PG only");
const root=new URL("../../",import.meta.url);
const db="flappy_integration_"+Date.now();
const flags=["-X","-qAt","-v","ON_ERROR_STOP=1","-h","127.0.0.1","-p","55439","-U","postgres"];
const env={...process.env};delete env.PGSERVICE;delete env.PGSERVICEFILE;
function sql(s,database=db){return execFileSync("psql",[...flags,"-d",database,"-c",s],{env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();}
function file(p){return execFileSync("psql",[...flags,"-d",db,"-1","-f",new URL(p,root).pathname],{env,encoding:"utf8",stdio:["ignore","pipe","pipe"]});}
function lit(v){return v===null?"null":typeof v==="number"?String(v):Array.isArray(v)?"ARRAY["+v.join(",")+"]::integer[]":"'"+String(v).replaceAll("'","''")+"'";}
async function rpc(name,args){
  try{const command="set role service_role; select public."+name+"("+Object.entries(args).map(([k,v])=>k+"=>"+lit(v)).join(",")+");";
    const r=await exec("psql",[...flags,"-d",db,"-c",command],{env,encoding:"utf8"});let data=r.stdout.trim();return {data:data?(data==='t'?true:data==='f'?false:JSON.parse(data)):null,error:null};
  }catch(err){return {data:null,error:{code:"P0001",message:"rejected"}};}
}
function compile(path,imports){
 const m={exports:{}},s=readFileSync(new URL(path,root),"utf8");
 new Function("exports","module","require",ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m.exports,m,n=>n in imports?imports[n]:require(n));return m.exports;
}
const engine=compile("lib/game/flappy/engine.ts",{});
const bounded=compile("lib/competition/request-body.ts",{"server-only":{},"@/lib/security/competition-access":{recordCompetitionAccess:async()=>"allowed",competitionAccessMessage:()=>"unavailable"}});
const api=compile("lib/game/flappy/server.ts",{"server-only":{},"@/lib/security/competition-access":{recordCompetitionAccess:async()=>"allowed",competitionAccessMessage:()=>"unavailable"},"@/lib/security/auth-401-review":{isGameAccessHeld:async()=>false},"@/lib/competition/request-body":bounded,"@/lib/supabase/admin":{createAdminClient:()=>({rpc})},"@/lib/supabase/server":{getVerifiedUserContext:async()=>null},"./activation":{FLAPPY_COMPETITION_ENABLED:false},"./engine":engine});
const A="11111111-1111-4111-8111-111111111111",B="22222222-2222-4222-8222-222222222222";
const C="33333333-3333-4333-8333-333333333333",D="44444444-4444-4444-8444-444444444444";
function request(body){return new Request("https://test/api",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});}
function handle(action,body,player=A){return api.handleFlappy(action,request(body),{access:async()=>"allowed",enabled:true,user:async()=>player,admin:()=>({rpc}),now:Date.now});}
let checks=0;function pass(name){checks++;console.log("PASS "+name);}
sql("create database "+db,"postgres");
try{
 file("supabase/verification/local-auth-bootstrap.sql");
 const migrations=readdirSync(new URL("supabase/migrations",root)).filter(p=>/^\d+_.+\.sql$/.test(p)).sort();
 for(const p of migrations.filter(p=>!p.includes("flappy_")))file("supabase/migrations/"+p);
 const fingerprint=()=>sql("select md5(string_agg(pg_get_functiondef(p.oid),'|' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname not like 'flappy_%'");
 const before=fingerprint();
 for(const p of migrations.filter(p=>p.includes("flappy_")))file("supabase/migrations/"+p);
 assert.equal(fingerprint(),before);pass("Race To Win function bodies unchanged by additive migration");
 assert.equal(sql("select enabled from private.flappy_control"),"f");
 assert.equal((await rpc("flappy_consume_quota",{p_player:A,p_action:"start"})).data,false);pass("database gate defaults closed");
 sql("insert into auth.users(id,email_confirmed_at) values "+[A,B,C,D].map(p=>"("+lit(p)+",now())").join(","));
}catch(error){console.error("SETUP FAILED",error.stderr?.toString()||error);sql("drop database "+db,"postgres");throw error;}
try{
 // Fixture writes are isolated and privileged; no production connection exists.
 sql("insert into public.profiles(user_id,username) values("+lit(A)+",'Alpha'),("+lit(B)+",'Beta'),("+lit(C)+",'Gamma'),("+lit(D)+",'Delta')");
 sql("insert into public.games(slug,display_name) values('flappy-race','FlappyRace')");
 sql("update private.flappy_control set enabled=true");
 const ids=["private.flappy_sessions","private.flappy_runs","private.flappy_quotas","private.flappy_control","private.flappy_reward_reservations"];
 for(const role of ["anon","authenticated","service_role"]){
  for(const table of ids){
    assert.equal(sql("select has_table_privilege("+lit(role)+","+lit(table)+",'SELECT,INSERT,UPDATE,DELETE')"),"f");
    if(role!=="service_role")assert.throws(()=>sql("set role "+role+"; select public.flappy_read_session("+lit(A)+",gen_random_uuid())"));
  }
 }
 assert.equal(sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('flappy_control','flappy_sessions','flappy_runs','flappy_quotas','flappy_reward_reservations') and c.relrowsecurity"),"5");
 sql("grant usage on schema private to authenticated; grant select on private.flappy_control,private.flappy_sessions,private.flappy_runs,private.flappy_quotas,private.flappy_reward_reservations to authenticated");
 for(const table of ids)assert.equal(sql("set role authenticated; select count(*) from "+table),"0");
 sql("revoke select on private.flappy_control,private.flappy_sessions,private.flappy_runs,private.flappy_quotas,private.flappy_reward_reservations from authenticated; revoke usage on schema private from authenticated");
 pass("real PostgreSQL browser EXECUTE revoked, direct table privileges denied and RLS still denies accidental SELECT grants");
 const start=await handle("start",{});assert.equal(start.status,200);const session=await start.json();
 const id=session.sessionId;
 sql("update private.flappy_sessions set starts_at=now()-interval '2 seconds',expires_at=now()+interval '598 seconds',lease_until=now()+interval '15 seconds' where id="+lit(id));
 assert.equal((await handle("start",{})).status,409);pass("one active session per player");
 const empty=engine.replayFlappy(session.seed,[],100);assert.equal(empty.dead,true);
 assert.equal((await handle("finalize",{sessionId:id,inputs:[],throughTick:empty.tick,score:999})).status,400);
 assert.equal((await handle("finalize",{sessionId:id,inputs:[],throughTick:empty.tick,seed:0})).status,400);
 assert.equal((await handle("finalize",{sessionId:id,inputs:[],throughTick:empty.tick},B)).status,404);
 pass("forged scores/seeds and foreign ownership rejected against real session storage");
 assert.equal((await handle("checkpoint",{sessionId:id,inputs:[],throughTick:10})).status,200);
 assert.equal((await handle("checkpoint",{sessionId:id,inputs:[4],throughTick:11})).status,409);
 pass("checkpoint prefix cannot be rewritten");
 const body={sessionId:id,inputs:[],throughTick:empty.tick};
 const finals=await Promise.all([handle("finalize",body),handle("finalize",body)]);
 assert.ok(finals.every(r=>r.status===200));assert.deepEqual(await finals[0].json(),await finals[1].json());
 assert.equal(sql("select count(*) from private.flappy_runs where session_id="+lit(id)),"1");
 assert.equal((await handle("finalize",body)).status,200);
 assert.equal((await handle("finalize",{...body,inputs:[0]})).status,409);
 pass("concurrent finalizations and exact retries persist exactly one canonical under-review run");
 assert.equal(sql("select eligibility from private.flappy_runs where session_id="+lit(id)),"under_review");
 assert.equal(sql("select count(*) from public.validated_runs"),"0");
 pass("no unreviewed replay can enter Race To Win scores, prizes or ranking");
 const next=await (await handle("start",{},B)).json();
 sql("update private.flappy_sessions set lease_until=clock_timestamp()-interval '1 second' where id="+lit(next.sessionId));
 assert.equal((await handle("finalize",{sessionId:next.sessionId,inputs:[],throughTick:empty.tick},B)).status,409);
 pass("expired activity leases rejected");
 const fresh=await (await handle("start",{},B)).json();
 assert.equal((await handle("checkpoint",{sessionId:fresh.sessionId,inputs:[],throughTick:36000},B)).status,409);
 sql("update private.flappy_sessions set starts_at=now()-interval '2 seconds',expires_at=now()+interval '598 seconds',lease_until=now()+interval '15 seconds' where id="+lit(fresh.sessionId));
 assert.equal((await handle("checkpoint",{sessionId:fresh.sessionId,inputs:[],throughTick:36000},B)).status,409);
 assert.equal((await handle("finalize",{sessionId:fresh.sessionId,inputs:[],throughTick:10},B)).status,409);
 pass("future simulation and finalization without authoritative collision rejected");

 const calls=await Promise.all(Array.from({length:40},()=>rpc("flappy_consume_quota",{p_player:C,p_action:"checkpoint"})));
 assert.equal(calls.filter(r=>r.data===true).length,30);pass("atomic quota shared across 40 concurrent database connections");
 const concurrent=await Promise.all([handle("start",{},D),handle("start",{},D)]);
 assert.equal(concurrent.filter(r=>r.status===200).length,1);pass("concurrent start serialized at database boundary");

 // Review fixtures for real ranking calculations, all with independent session IDs.
 const game=sql("select id from public.games where slug='flappy-race'");
 function fixture(player,score,day){
   sql("with s as (insert into private.flappy_sessions(player_id,game_id,version,seed,status,starts_at,expires_at,lease_until,outcome) values("+lit(player)+","+lit(game)+",'flappy-v1',1,'finalized',now(),now()+interval '10 minutes',now(),'{\"score\":0}') returning id) insert into private.flappy_runs(session_id,player_id,game_id,score,collision_tick,completed_at,tournament_day,tournament_week_start,eligibility,review_actor,reviewed_at,review_note) select id,"+lit(player)+","+lit(game)+","+score+",40,"+lit(day)+"::date,"+lit(day)+"::date,date_trunc('week',"+lit(day)+"::timestamp)::date,'valid',"+lit(D)+",now(),'isolated fixture' from s");
 }
 for(const p of [A,B])for(const score of [1,2,3,4,5,6,7,8])fixture(p,score,"2026-10-19");
 fixture(C,36,"2026-10-19");
 let board=(await rpc("flappy_read_ranking",{p_week:"2026-10-19",p_page:1})).data;
 const alpha=board.entries.find(e=>e.username==="Alpha"), beta=board.entries.find(e=>e.username==="Beta");
 assert.equal(alpha.weeklyTotal,35);assert.equal(beta.weeklyTotal,35);assert.equal(alpha.rank,null);assert.equal(alpha.reviewRequired,true);
 assert.equal(board.entries[0].username,"Gamma");assert.equal(board.entries[0].weeklyTotal,36);
 fixture(A,1,"2026-10-20");board=(await rpc("flappy_read_ranking",{p_week:"2026-10-19",p_page:1})).data;
 assert.equal(board.entries[0].username,"Gamma"); // 36 total, best individual 36 > 8.
 assert.equal(board.entries[1].username,"Alpha");assert.equal(board.entries[1].weeklyTotal,36);
 fixture(D,500,"2026-10-26");
 assert.ok(!(await rpc("flappy_read_ranking",{p_week:"2026-10-19",p_page:1})).data.entries.some(e=>e.username==="Delta"));
 assert.equal(sql("select (timestamptz '2026-10-19 03:59:59+00' at time zone 'America/New_York')::date"),"2026-10-18");
 assert.equal(sql("select (timestamptz '2026-10-19 04:00:00+00' at time zone 'America/New_York')::date"),"2026-10-19");
 pass("real SQL top seven/day, weekly sum, descending vectors, exact ties and NY week isolation");
 // Force a transactional insert error; the session must remain active.
 const active=await (await handle("start",{},C)).json();
 sql("update private.flappy_sessions set starts_at=now()-interval '2 seconds',expires_at=now()+interval '598 seconds',lease_until=now()+interval '15 seconds' where id="+lit(active.sessionId));
 sql("create function private.test_flappy_abort() returns trigger language plpgsql as $$begin raise exception 'test abort'; end$$; create trigger test_abort before insert on private.flappy_runs for each row execute function private.test_flappy_abort()");
 const e=engine.replayFlappy(active.seed,[],100);
 assert.equal((await handle("finalize",{sessionId:active.sessionId,inputs:[],throughTick:e.tick},C)).status,409);
 assert.equal(sql("select status from private.flappy_sessions where id="+lit(active.sessionId)),"active");
 pass("forced insert failure rolls back finalization atomically");

 // New admin access is active-admin checked, server-only, independent of rewards.
 assert.ok((await rpc("flappy_admin_read",{p_actor:A,p_page:1,p_session:null})).error);
 sql("insert into private.admin_users(user_id,is_active) values("+lit(D)+",true)");
 const list=(await rpc("flappy_admin_read",{p_actor:D,p_page:1,p_session:null})).data;
 assert.ok(Array.isArray(list)&&list.length>0);assert.ok(list.every(r=>r.seed===null&&r.inputs===null));
 const detail=(await rpc("flappy_admin_read",{p_actor:D,p_page:1,p_session:id})).data;
 assert.equal(detail.length,1);assert.equal(detail[0].session_id,id);
 assert.deepEqual(detail[0].inputs,[]);assert.equal(detail[0].seed,session.seed);
 const audit=compile("lib/game/flappy/admin-review.ts",{"server-only":{},"@/lib/security/competition-access":{recordCompetitionAccess:async()=>"allowed",competitionAccessMessage:()=>"unavailable"},"./engine":engine});
 const summary=audit.summarizeFlappyAudit(detail[0]);assert.equal(summary.replayMatches,true);assert.equal("inputs" in summary,false);assert.equal("seed" in summary,false);
 assert.ok((await rpc("flappy_admin_read",{p_actor:D,p_page:0,p_session:id})).error);
 for(const role of ["anon","authenticated"])assert.throws(()=>sql("set role "+role+"; select public.flappy_admin_read("+lit(D)+",1,null)"));
 sql("update private.admin_users set is_active=false where user_id="+lit(D));
 assert.ok((await rpc("flappy_admin_read",{p_actor:D,p_page:1,p_session:id})).error);
 pass("admin detail/list require active admin and server role; anonymous/authenticated EXECUTE denied");
 // Ledger is a non-granting reservation only. No provider callbacks or consumers.
 sql("insert into private.flappy_reward_reservations(session_id,kind) values("+lit(id)+",'extra_life')");
 assert.throws(()=>sql("insert into private.flappy_reward_reservations(session_id,kind) values("+lit(id)+",'extra_life')"));
 assert.throws(()=>sql("insert into private.flappy_reward_reservations(session_id,kind) values("+lit(fresh.sessionId)+",'double_points')"));
 assert.throws(()=>sql("set role service_role; insert into private.flappy_reward_reservations(session_id,kind) values("+lit(fresh.sessionId)+",'extra_life')"));
 assert.equal(sql("select score from private.flappy_runs where session_id="+lit(id)),String(empty.score));
 assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'flappy_%reward%'"),"0");
 const reservationSql="insert into private.flappy_reward_reservations(session_id,kind) values("+lit(fresh.sessionId)+",'extra_life')";
 const reservationRace=await Promise.allSettled([0,1].map(()=>exec("psql",[...flags,"-d",db,"-c",reservationSql],{env,encoding:"utf8"})));
 assert.equal(reservationRace.filter(r=>r.status==="fulfilled").length,1);
 assert.equal(sql("select count(*) from private.flappy_reward_reservations where session_id="+lit(fresh.sessionId)),"1");
 pass("one reward slot per session; unsupported multipliers denied; no service/browser grant or consume path");

 console.log("PASS real PostgreSQL integration: "+checks+" groups; "+sql("select version()"));
}finally{sql("drop database "+db,"postgres");}
