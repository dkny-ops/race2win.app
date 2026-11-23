import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(path, imports = {}, turnstile = null) {
  const source = readFileSync(new URL("../"+path, import.meta.url),"utf8");
  const loadedModule = { exports:{} };
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function("module","exports","require",code)(loadedModule,loadedModule.exports,name=>name in imports?imports[name]:name==="@/lib/security/turnstile"?{getTurnstileWidgetConfiguration:()=>turnstile,verifyTurnstileToken:async()=>({status:"verified"})}:require(name));
  return loadedModule.exports;
}
const e=load("lib/game/flappy/engine.ts");
const diagnostics=load("lib/game/flappy/performance-diagnostics.ts");
const legacyStartRevocation=readFileSync(new URL("../supabase/migrations/20261123014958_revoke_legacy_flappy_start.sql",import.meta.url),"utf8");
const finalHumanProof=readFileSync(new URL("../supabase/migrations/20261123021029_flappy_final_human_proof.sql",import.meta.url),"utf8");
const finalProofMetadataFix=readFileSync(new URL("../supabase/migrations/20261123022124_fix_flappy_final_proof_review_metadata.sql",import.meta.url),"utf8");
const flappyCanvas=readFileSync(new URL("../components/game/flappy-verified-canvas.tsx",import.meta.url),"utf8");
export {load,e};
test("Flappy fixed-step replay is bit-identical and collision is authoritative",()=>{
  const a=e.replayFlappy(123,[],100);
  assert.deepEqual(a,e.replayFlappy(123,[],100));
  assert.equal(a.dead,true);assert.ok(a.tick<100);assert.equal(a.score,0);assert.ok(a.y>44400);
});
test("seeded obstacle layouts are reproducible and different seeds diverge",()=>{
  function simulate(seed){const s=e.initialFlappy(seed);for(let n=0;n<140&&!s.dead;n++)e.stepFlappy(s,s.y>25000&&s.vy>0);return s;}
  assert.deepEqual(simulate(9),simulate(9));
  assert.notDeepEqual(simulate(9).pipes,simulate(10).pipes);
});
test("precomputed speed keeps the original v1 integer difficulty schedule",()=>{
  let expected=215;
  for(let step=0;step<40;step++){
    assert.equal(e.flappySpeed(step*900),expected);
    const increase=step<2?103:(step+1)%4===0?110:106;
    expected=Math.round(expected*increase/100);
  }
});
test("Flappy performance diagnostics stay opt-in and bounded",()=>{
  const disabled=new diagnostics.FlappyPerformanceDiagnostics(false);
  disabled.record({kind:"frame",frameMs:500});
  assert.equal(disabled.snapshot().length,0);
  const enabled=new diagnostics.FlappyPerformanceDiagnostics(true);
  for(let n=0;n<260;n++) enabled.record({kind:"frame",frameMs:n});
  assert.equal(enabled.snapshot().length,240);
  assert.equal(enabled.snapshot()[0].frameMs,20);
});
test("official Flappy sessions receive a fresh server-generated course seed",()=>{
  const server=readFileSync(new URL("../lib/game/flappy/server.ts",import.meta.url),"utf8");
  assert.match(server,/randomInt\(0x1_0000_0000\)/);
  assert.doesNotMatch(server,/FLAPPY_COURSE_SEED/);
});
test("legacy Flappy START cannot bypass the server-bound human preflight",()=>{
  assert.match(legacyStartRevocation,/revoke all on function public\.flappy_start\(uuid,bigint,text\) from public,anon,authenticated,service_role/i);
  assert.doesNotMatch(legacyStartRevocation,/grant execute/i);
});
test("Flappy final human proof is session-bound and never grants browser RPC access",()=>{
  assert.match(finalHumanProof,/create table if not exists private\.flappy_final_checks/i);
  assert.match(finalHumanProof,/revoke all on table private\.flappy_final_checks from public, anon, authenticated, service_role/i);
  assert.match(finalHumanProof,/revoke all on function public\.flappy_create_final_check\(uuid,uuid\) from public,\s*anon,\s*authenticated,\s*service_role/i);
  assert.match(finalHumanProof,/grant execute on function public\.flappy_create_final_check\(uuid,uuid\),public\.flappy_verify_final_check\(uuid,uuid,uuid\) to service_role/i);
  assert.match(finalHumanProof,/new\.eligibility:='under_review'/i);
});
test("held Flappy runs preserve the database review-metadata invariant",()=>{
  assert.match(finalProofMetadataFix,/new\.eligibility:='under_review';\s*new\.review_note:=null/i);
  assert.match(finalProofMetadataFix,/eligibility=case when v_perfect then 'under_review' else 'valid' end, verification='replay_verified', review_note=null/i);
});
test("Flappy waits for its independent final proof before completing an official result",()=>{
  assert.match(flappyCanvas,/await finalizeFlappyOfficial\(official\.current, engine\.current, inputs\.current\);[\s\S]{0,160}const challenge = await prepareFlappyFinalProof\(official\.current\.sessionId\);/);
  assert.match(flappyCanvas,/setFinalProofToken\(null\); setFinalProof\(challenge\);/);
  assert.doesNotMatch(flappyCanvas,/setResult\(verified\); setFinalProofToken\(null\); setFinalProof\(challenge\);/);
  assert.match(flappyCanvas,/completeFlappyFinalProof\(official\.current\.sessionId, finalProof\.nonce, finalProofToken\)[\s\S]{0,400}setResult\(verified\)/);
  assert.match(flappyCanvas,/A collision can race an in-flight checkpoint[\s\S]{0,600}await finalizeFlappyOfficial\(official\.current,engine\.current,inputs\.current\);[\s\S]{0,220}setFinalProof\(challenge\)/);
  assert.doesNotMatch(flappyCanvas,/const verified=await finalizeFlappyOfficial\(official\.current,engine\.current,inputs\.current\);[\s\S]{0,160}setResult\(verified\);setStatus\("over"\)/);
});
test("oversize, reordered, fractional, impossible and post-collision inputs are rejected",()=>{
  for(const [inputs,tick] of [[[2,1],10],[[0,1],10],[[0,4.2],10],[[-1],10],[[10],10],[[],0],[[],36001],[Array(6001).fill(1),100]])assert.equal(e.parseFlaps(inputs,tick),null);
  assert.equal(e.replayFlappy(1,[99],100),null);
  for(const seed of [-1,1.5,4294967296,NaN])assert.throws(()=>e.initialFlappy(seed));
});
test("incremental rendering and replay agree for recorded real-time inputs",()=>{
  const s=e.initialFlappy(0xabcdef),inputs=[];
  while(!s.dead&&s.tick<1500){
    const target=s.pipes.find(p=>p.x+5400>6900)?.gap??22000;
    const flap=s.y>target&&s.vy>0&&(s.tick-(inputs.at(-1)??-4)>=4);
    if(flap)inputs.push(s.tick);
    e.stepFlappy(s,flap);
  }
  assert.deepEqual(e.replayFlappy(0xabcdef,inputs,s.tick),s);
});
const bounded=load("lib/competition/request-body.ts",{"server-only":{},"@/lib/security/competition-access":{recordCompetitionAccess:async()=>"allowed",competitionAccessMessage:()=>"unavailable"}});
const flappyImports={
 "server-only":{},"@/lib/security/competition-access":{recordCompetitionAccess:async()=>"allowed",competitionAccessMessage:()=>"unavailable"},"@/lib/competition/request-body":bounded,
 "@/lib/security/auth-401-review":{isGameAccessHeld:async()=>false},
 "@/lib/supabase/admin":{createAdminClient:()=>assert.fail("unconfigured database")},
 "@/lib/supabase/server":{getVerifiedUserContext:async()=>null},
 "./activation":{FLAPPY_COMPETITION_ENABLED:false},"./engine":e,
};
const api=load("lib/game/flappy/server.ts",flappyImports,{siteKey:"test-site-key"});
function req(body){return new Request("https://test/api",{method:"POST",headers:{origin:"https://test","Content-Type":"application/json"},body:JSON.stringify(body)});}
test("official endpoints remain locked by reviewed code and require live identity",async()=>{
  const db=()=>assert.fail("closed endpoint must not access DB");
  assert.equal((await api.handleFlappy("start",req({token:"test-token"}),{access:async()=>"allowed",enabled:false,user:async()=>null,admin:db,now:Date.now})).status,401);
  assert.equal((await api.handleFlappy("start",req({}),{access:async()=>"allowed",enabled:false,user:async()=>"player",admin:db,now:Date.now})).status,403);
});
test("authority fields, wrong seeds, forged score and hostile origins cannot enter session APIs",async()=>{
  const deps={access:async()=>"allowed",enabled:true,user:async()=>"player",admin:()=>({rpc:async()=>({data:true,error:null})}),now:Date.now};
  for(const body of [{score:9999},{seed:1},{sessionId:"not-uuid",throughTick:10,inputs:[]}]){
    assert.equal((await api.handleFlappy("finalize",req(body),deps)).status,400);
  }
  const r=req({});r.headers.set("origin","https://attacker.invalid");
  assert.equal((await api.handleFlappy("start",r,deps)).status,403);
});

test("an automated controller can generate a physically valid replay: replay is not proof of human play",()=>{
  const s=e.initialFlappy(0),inputs=[];
  while(!s.dead&&s.tick<3000){
    const target=s.pipes.find(p=>p.x+5400>6900)?.gap??22000;
    const flap=s.y>target+1500&&s.vy>0&&s.tick-(inputs.at(-1)??-4)>=4;
    if(flap)inputs.push(s.tick);e.stepFlappy(s,flap);
  }
  while(!s.dead&&s.tick<e.MAX_TICKS)e.stepFlappy(s,false);
  assert.ok(s.score>0);assert.equal(s.dead,true);
  assert.deepEqual(e.replayFlappy(0,inputs,s.tick),s);
});

test("access holds and missing tournament consent deny sessions before quota or storage",async()=>{
 for(const reason of ["review_required","terms_required"]){
  const response=await api.handleFlappy("start",req({}),{enabled:true,user:async()=>"verified",access:async()=>reason,admin:()=>assert.fail("Access rejection must precede quota"),now:Date.now,configuration:()=>({siteKey:"test-site-key"}),verify:async()=>({status:"verified"})});
  assert.equal(response.status,403);assert.equal((await response.json()).code,reason);
 }
 const failure=await api.handleFlappy("start",req({}),{enabled:true,user:async()=>"verified",access:async()=>{throw new Error("unavailable");},admin:()=>assert.fail("Access failure must fail closed"),now:Date.now});
 assert.equal(failure.status,503);
});

test("player access reuses the existing hold and terms policy scoped to verified identity",async()=>{
 for(const policy of [{held:true,terms:"2026-10-18",expected:"review_required"},{held:false,terms:null,expected:"terms_required"},{held:false,terms:"2026-10-18",expected:"allowed"}]){
  let reads=0;
  const access=load("lib/game/flappy/server.ts",{
   "server-only":{},"@/lib/security/competition-access":{recordCompetitionAccess:async()=>"allowed",competitionAccessMessage:()=>"unavailable"},"@/lib/competition/request-body":bounded,"./activation":{FLAPPY_COMPETITION_ENABLED:false},"./engine":e,
   "@/lib/supabase/server":{getVerifiedUserContext:async()=>null},
   "@/lib/security/auth-401-review":{isGameAccessHeld:async id=>{assert.equal(id,"verified-player");return policy.held;}},
   "@/lib/supabase/admin":{createAdminClient:()=>({from(table){assert.equal(table,"player_terms_acceptances");reads++;return{select:()=>({eq:(key,id)=>{assert.equal(key,"player_id");assert.equal(id,"verified-player");return{maybeSingle:async()=>({data:policy.terms?{terms_version:policy.terms}:null,error:null})};}})};}})},
  });
  assert.equal(await access.flappyPlayerAccess("verified-player"),policy.expected);assert.equal(reads,policy.held?0:1);
 }
});

const preflightNonce="11111111-1111-4111-8111-111111111112";
test("official START returns a server clock reference for monotonic client scheduling",async()=>{
 const now=Date.parse("2026-10-26T04:00:00Z");
 const admin=()=>({rpc:async(name)=>name==="flappy_turnstile_enabled"?{data:true,error:null}:name==="flappy_consume_quota"?{data:true,error:null}:name==="flappy_turnstile_status"?{data:{required:true},error:null}:{data:{sessionId:"11111111-1111-4111-8111-111111111111",seed:42,version:"flappy-v1",startsAt:new Date(now+3000).toISOString(),expiresAt:new Date(now+603000).toISOString()},error:null}});
 const r=await api.handleFlappy("start",req({token:"valid-token",nonce:preflightNonce}),{enabled:true,user:async()=>"verified",access:async()=>"allowed",admin,now:()=>now,configuration:()=>({siteKey:"test-site-key"}),verify:async(_token,_action,options)=>{assert.equal(options.expectedCdata,preflightNonce);return {status:"verified"};}});
 assert.equal(r.status,200);assert.equal((await r.json()).serverNow,new Date(now).toISOString());
});

test("start reports exhausted rolling limit, active session and server errors separately", async () => {
 for (const [message, dbcode, status, code] of [["Hourly limit","P0001",429,"attempts_exhausted"],["Concurrent session","P0001",409,"session_active"],["secret SQL failure","XX000",503,"start_rejected"]]) {
  const response = await api.handleFlappy("start",req({token:"valid-token",nonce:preflightNonce}),{access:async()=>"allowed",enabled:true,user:async()=>"verified",admin:()=>({rpc:async name=>name==="flappy_turnstile_enabled"?{data:true,error:null}:name==="flappy_consume_quota"?{data:true,error:null}:{data:null,error:{code:dbcode,message}}}),now:Date.now,configuration:()=>({siteKey:"test-site-key"}),verify:async()=>({status:"verified"})});
  assert.equal(response.status,status); assert.equal((await response.json()).code,code);
 }
});

test("verified pregame Flappy start consumes quota and creates server-owned sessions",async()=>{
 const calls=[];
 const missingProviderApi=load("lib/game/flappy/server.ts",flappyImports,null);
 const now=Date.parse("2026-10-26T04:00:00Z");
 const r=await missingProviderApi.handleFlappy("start",req({token:"valid-token",nonce:preflightNonce}),{access:async()=>"allowed",enabled:true,user:async()=>"verified",admin:()=>({rpc:async name=>{calls.push(name);return name==="flappy_consume_quota"?{data:true,error:null}:{data:{sessionId:"11111111-1111-4111-8111-111111111111",seed:42,version:"flappy-v1",startsAt:new Date(now+3000).toISOString(),expiresAt:new Date(now+603000).toISOString()},error:null};}}),now:()=>now,configuration:()=>({siteKey:"test-site-key"}),verify:async()=>({status:"verified"})});
 assert.equal(r.status,200);
 assert.deepEqual(calls,["flappy_consume_quota","flappy_start"]);
 assert.equal((await r.json()).turnstile,undefined);
});

test("Flappy official START refuses missing or rejected Turnstile before quota", async () => {
  let called = false;
  const deps = { enabled:true, user:async()=>"verified", access:async()=>"allowed",
    admin:()=>{called=true;throw new Error("Quota must not be touched");}, now:Date.now,
    configuration:()=>({siteKey:"test-site-key"}), verify:async()=>({status:"rejected",reason:"provider_rejected"}) };
  assert.equal((await api.handleFlappy("start",req({token:"invalid"}),deps)).status,403);
  assert.equal((await api.handleFlappy("start",req({}),deps)).status,403);
  assert.equal(called,false);
});
