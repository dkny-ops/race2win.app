import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const actor='11111111-1111-4111-8111-111111111111',player='22222222-2222-4222-8222-222222222222';
function load({authorized=true,state='approved',winnerStatus=null,rpcError=false,prizesEnabled=true}={}){
 const calls=[],compiled={exports:{}},controls=()=>null;
 const fixtures={
  games:{id:'flappy-only'},
  weekly_tournament_totals:[{player_id:player,tournament_week_start:'2026-10-19',weekly_total_score:100,rank_position:1,tie_break_status:'resolved'}],
  fraud_flags:[],daily_top_scores:[],prize_balances:[{player_id:player,available_cents:0}],profiles:[{user_id:player,username:'SyntheticPlayer'}],
  provisional_winners:winnerStatus?[{player_id:player,award_type:'weekly_tournament',amount_cents:500,status:winnerStatus}]:[],
 };
 const admin={
  from:name=>{
   calls.push({table:name});const chain={then:resolve=>resolve({data:fixtures[name],error:null})};
   for(const method of ['select','eq','gte','lte','order','limit','in'])chain[method]=()=>chain;
   chain.maybeSingle=async()=>({data:fixtures[name],error:null});return chain;
  },
  rpc:async(name,args)=>{calls.push({name,args});return {data:{enabled:prizesEnabled,candidates:[{playerId:player,state,effectiveRank:1}]},error:rpcError?{}:null};},
 };
 const missing=Error('NOT_FOUND');
 const imports={
  'react/jsx-runtime':require('react/jsx-runtime'),'next/link':()=>null,
  'next/navigation':{notFound:()=>{throw missing;}},
  './prize-controls':{FlappyPrizeControls:controls},'../balance-history':{BalanceHistory:()=>null},'../block-player-control':{BlockPlayerControl:()=>null},
  '@/lib/security/prize-admin':{getAuthorizedPrizeAdmin:async()=>authorized?{context:{userId:actor},admin}:null},
  '@/lib/competition/scores':{currentNewYorkTournamentWeek:()=> '2026-10-26'},
 };
 const source=readFileSync(new URL('../app/admin/prize-review/flappy-race/page.tsx',import.meta.url),'utf8');
 new Function('exports','module','require',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(compiled.exports,compiled,name=>name in imports?imports[name]:assert.fail(name));
 const find=node=>Array.isArray(node)?node.flatMap(find):node&&typeof node==='object'?[...(node.type===controls?[node.props]:[]),...find(node.props?.children)]:[];
 return {render:compiled.exports.default,find,calls,missing};
}
test('approved frozen candidate enables credit review even when no financial winner exists yet',async()=>{
 const page=load();const tree=await page.render();assert.equal(page.find(tree)[0].status,'approved');
 assert.deepEqual(page.calls.find(c=>c.name),{name:'flappy_admin_read_prize_cases',args:{p_actor:actor,p_week:'2026-10-19'}});
});
test('financial winner status cannot impersonate candidate approval; disabled prize program fails closed',async()=>{
 const pending=load({state:'pending_review',winnerStatus:'approved_for_payment'});
 assert.equal(pending.find(await pending.render())[0].status,'pending_review');
 const disabled=load({prizesEnabled:false});assert.equal(disabled.find(await disabled.render()).length,0,'disabled prize program must not render credit controls');
});
test('candidate read errors and unauthorized page access fail closed',async()=>{
 await assert.rejects(load({rpcError:true}).render());
 const denied=load({authorized:false});await assert.rejects(denied.render(),error=>error===denied.missing);assert.equal(denied.calls.length,0);
});
