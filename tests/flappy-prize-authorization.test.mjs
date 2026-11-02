import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const actor='11111111-1111-4111-8111-111111111111';
const player='22222222-2222-4222-8222-222222222222';
const body={week:'2026-10-19',playerId:player,action:'allocate',note:'Owner reviewed the frozen candidate'};
function load({authorized=true,rpcError=false,unavailable=false}={}){
 const calls=[],authCalls=[],compiled={exports:{}};
 const imports={
  'next/server':require('next/server'),
  '@/lib/competition/request-body':{readBoundedJson:r=>r.json()},
  '@/lib/game/flappy/tournament':{parseFlappyWeek:v=>v==='2026-10-19'?v:null},
  '@/lib/security/prize-admin':{getAuthorizedPrizeAdmin:async()=>{
   authCalls.push(true);
   return authorized?{context:{userId:actor},admin:{rpc:async(name,args)=>{
    calls.push({name,args});if(unavailable)throw Error('unavailable');
    return {data:null,error:rpcError?{message:'Sensitive database diagnostic'}:null};
   }}}:null;
  }},
 };
 const source=readFileSync(new URL('../app/api/admin/flappy-race/prizes/route.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('exports','module','require',code)(compiled.exports,compiled,name=>name in imports?imports[name]:assert.fail(name));
 return {...compiled.exports,calls,authCalls};
}
const request=(input=body,headers={})=>new Request('https://test.invalid/api/admin/flappy-race/prizes',{
 method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json',...headers},body:JSON.stringify(input),
});
test('prize endpoint denies cross-origin and unauthenticated access before invoking financial RPCs',async()=>{
 const cross=load();assert.equal((await cross.POST(request(body,{origin:'https://evil.invalid'}))).status,403);
 assert.equal((await cross.POST(request(body,{'sec-fetch-site':'cross-site'}))).status,403);
 assert.equal(cross.authCalls.length,0);assert.equal(cross.calls.length,0);
 const anonymous=load({authorized:false});assert.equal((await anonymous.POST(request())).status,404);assert.equal(anonymous.calls.length,0);
});
test('browser cannot supply actor, amount, rank, payment action or malformed identifiers',async()=>{
 for(const input of [{...body,actor},{...body,amountCents:999999},{...body,rankPosition:1},
  {...body,action:'paid'},{...body,playerId:'invalid'},{...body,playerId:player.slice(0,23)},{...body,week:'invalid'},
  {...body,note:''},{...body,note:'x'.repeat(501)}]){
  const api=load();assert.equal((await api.POST(request(input))).status,400);assert.equal(api.calls.length,0);
 }
});
test('allocation RPC gets only validated fields and the server-authenticated actor; no payout RPC is called',async()=>{
 const api=load();const result=await api.POST(request());assert.equal(result.status,200);
 assert.deepEqual(api.calls,[{name:'flappy_admin_allocate_prize',args:{p_actor:actor,p_week:body.week,p_player:player,p_note:body.note}}]);
 assert.match((await result.json()).message,/No payment was executed/);
});
test('human candidate decision remains separate from credit approval',async()=>{
 const api=load();const result=await api.POST(request({...body,action:'approved'}));assert.equal(result.status,200);
 assert.deepEqual(api.calls,[{name:'flappy_decide_prize_candidate',args:{p_actor:actor,p_week:body.week,p_player:player,p_decision:'approved',p_note:body.note}}]);
 assert.match((await result.json()).message,/No credit or payment was created/);
});
test('database conflicts and unavailable services fail closed without disclosing SQL details',async()=>{
 const conflict=await load({rpcError:true}).POST(request());assert.equal(conflict.status,409);
 assert.doesNotMatch(JSON.stringify(await conflict.json()),/Sensitive|database diagnostic/);
 assert.equal((await load({unavailable:true}).POST(request())).status,503);
});

function loadAdmin({email='racetowinapp@gmail.com',confirmed=true,identityId=actor,active=true,rpcError=false,metadata={}}={}){
 const compiled={exports:{}},calls=[];
 const imports={
  '@/lib/supabase/server':{getVerifiedUserContext:async()=>({userId:actor,supabase:{auth:{getUser:async()=>({error:null,data:{user:{id:identityId,email,email_confirmed_at:confirmed?'2026-01-01':null,user_metadata:metadata}}})}}})},
  '@/lib/supabase/admin':{isAdminConfigured:()=>true,createAdminClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:active,error:rpcError?{}:null};}})},
 };
 const source=readFileSync(new URL('../lib/security/prize-admin.ts',import.meta.url),'utf8');
 new Function('exports','module','require',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(compiled.exports,compiled,name=>name in imports?imports[name]:assert.fail(name));
 return {...compiled.exports,calls};
}
test('user-editable metadata, unconfirmed email and mismatched identity cannot authorize prize administration',async()=>{
 for(const scenario of [{email:'player@example.invalid',metadata:{email:'racetowinapp@gmail.com',role:'admin'}},
  {confirmed:false},{identityId:player}]){
  const auth=loadAdmin(scenario);assert.equal(await auth.getAuthorizedPrizeAdmin(),null);assert.equal(auth.calls.length,0);
 }
});
test('confirmed owner still requires an active server-side admin decision; errors deny access',async()=>{
 for(const scenario of [{active:false},{rpcError:true}])assert.equal(await loadAdmin(scenario).getAuthorizedPrizeAdmin(),null);
 const auth=loadAdmin();assert.equal((await auth.getAuthorizedPrizeAdmin()).context.userId,actor);
 assert.deepEqual(auth.calls,[{name:'rtw_server_is_active_admin',args:{p_actor_user_id:actor}}]);
});
