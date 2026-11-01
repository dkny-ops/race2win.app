import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(path, imports={}) {
 const m={exports:{}};
 const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('module','exports','require',code)(m,m.exports,name=>name in imports?imports[name]:require(name));
 return m.exports;
}
const {FlappyInvisibleVerification}=load('lib/game/flappy/invisible-verification.ts');
const id='11111111-1111-4111-8111-111111111111',nonce='22222222-2222-4222-8222-222222222222';
const now=Date.now();
const state=(delta=0)=>({required:true,serverNow:new Date(now).toISOString(),nextDueAt:new Date(now+delta).toISOString(),due:delta<=0,nonce:delta<=0?nonce:null});
test('short collisions never execute Cloudflare; due collisions wait for a fresh verified token',async()=>{
 let calls=0,tokens=0;
 const config={...state(15000),siteKey:'public-key'};
 const short=new FlappyInvisibleVerification(id,config,async()=>{calls++;return state();},async()=>{tokens++;return 'token';});
 await short.finish(now+5000);assert.equal(calls,0);assert.equal(tokens,0);short.stop();
 const check=new FlappyInvisibleVerification(id,{...state(),siteKey:'public-key'},async body=>{
   calls++;if(!body.token)return state();assert.equal(body.nonce,nonce);assert.equal(body.sessionId,id);return state(30000);
 },async(key,value)=>{assert.equal(key,'public-key');assert.equal(value,nonce);tokens++;return 'fresh-token';});
 await check.finish(now+1000);assert.equal(tokens,1);assert.equal(calls,2);check.stop();
});
test('provider rejection cannot silently authorize a due result',async()=>{
 const check=new FlappyInvisibleVerification(id,{...state(),siteKey:'key'},async()=>state(),async()=>{throw Error('provider rejected');});
 await assert.rejects(()=>check.finish(now+1000));check.stop();
});
test('stopping during token generation prevents a late token being sent to another run',async()=>{
 let resolve,posts=0;
 const check=new FlappyInvisibleVerification(id,{...state(),siteKey:'key'},async body=>{if(body.token)posts++;return state();},()=>new Promise(r=>{resolve=r;}));
 const finished=check.finish(now+1000);await Promise.resolve();await Promise.resolve();
 check.stop();resolve('token');await assert.rejects(()=>finished);assert.equal(posts,0);
});
const verifier=load('lib/security/turnstile.ts',{'server-only':{}});
test('Siteverify must match action, hostname and this session challenge; existing login verification still works',async()=>{
 const saved={...process.env};
 Object.assign(process.env,{TURNSTILE_ENFORCEMENT_ENABLED:'true',TURNSTILE_MIDRUN_ENABLED:'true',TURNSTILE_SECRET_KEY:'isolated-test-secret-long',NEXT_PUBLIC_TURNSTILE_SITE_KEY:'public-test-key',TURNSTILE_ALLOWED_HOSTNAMES:'game.example',TURNSTILE_ENABLED_ACTIONS:'otp_request'});
 const response=body=>async()=>new Response(JSON.stringify(body),{status:200});
 const good={success:true,action:'midrun_human_check',hostname:'game.example',cdata:nonce};
 try {
  assert.equal((await verifier.verifyTurnstileToken('token','midrun_human_check',{expectedCdata:nonce,fetchImpl:response(good)})).status,'verified');
  for(const patch of [{cdata:'other'},{action:'otp_request'},{hostname:'other.example'},{success:false,'error-codes':['timeout-or-duplicate']}])assert.equal((await verifier.verifyTurnstileToken('token','midrun_human_check',{expectedCdata:nonce,fetchImpl:response({...good,...patch})})).status,'rejected');
  assert.equal((await verifier.verifyTurnstileToken('token','otp_request',{fetchImpl:response({...good,action:'otp_request',cdata:undefined})})).status,'verified');
  assert.equal((await verifier.verifyTurnstileToken('token','midrun_human_check',{expectedCdata:nonce,fetchImpl:async()=>{throw Error('offline');}})).status,'unavailable');
 } finally { for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved); }
});
const route=load('lib/game/flappy/human-check-server.ts',{
 'server-only':{},'@/lib/competition/request-body':load('lib/competition/request-body.ts',{'server-only':{}}),
 '@/lib/supabase/admin':{createAdminClient:()=>null},'@/lib/supabase/server':{getVerifiedUserContext:async()=>null},
 '@/lib/security/turnstile':verifier,'./activation':{FLAPPY_COMPETITION_ENABLED:false},'./server':{flappyPlayerAccess:async()=> 'allowed'},
});
const request=(body,origin='https://game.example')=>new Request('https://game.example/api/flappy-race/sessions/human-check',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('human-check endpoint authenticates, bounds requests and rejects stale nonces before contacting provider',async()=>{
 let provider=0,verified=0;
 const deps={enabled:true,user:async()=>id,access:async()=> 'allowed',configuration:()=>({siteKey:'key'}),verify:async(token,action,options)=>{provider++;assert.equal(options.expectedCdata,nonce);return {status:'verified'};},admin:()=>({rpc:async name=>{
  if(name==='flappy_consume_quota')return {data:true};
  if(name==='flappy_turnstile_status')return {data:state()};
  if(name==='flappy_turnstile_verify'){verified++;return {data:state(30000)};}
  throw Error(name);
 }})};
 const handle=(body,overrides={},origin)=>route.handleFlappyHumanCheck(request(body,origin),{...deps,...overrides});
 assert.equal((await handle({sessionId:id},{user:async()=>null})).status,401);
 assert.equal((await handle({sessionId:id},{},'https://attacker.example')).status,403);
 assert.equal((await handle({sessionId:id,nonce:id,token:'token'})).status,409);
 assert.equal((await handle({sessionId:id,nonce,token:'x'.repeat(5000)})).status,400);
 assert.equal(provider,0);
 assert.equal((await handle({sessionId:id,nonce,token:'token'},{verify:async()=>({status:'rejected',reason:'provider_rejected'})})).status,403);assert.equal(verified,0);
 assert.equal((await handle({sessionId:id,nonce,token:'token'})).status,200);assert.equal(provider,1);assert.equal(verified,1);
});
