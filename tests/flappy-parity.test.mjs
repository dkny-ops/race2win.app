import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const require=createRequire(import.meta.url);
function load(path,imports={}){
 const m={exports:{}};
 const code=ts.transpileModule(readFileSync(new URL("../"+path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function("exports","module","require",code)(m.exports,m,n=>n in imports?imports[n]:n==="@/components/game/flappy-admin-controls"?{FlappyAdminControls:()=>null,FlappyWeekCloseControl:()=>null}:n==="@/lib/game/flappy/tournament"?{previousFlappyWeek:()=>"2026-10-19"}:require(n));return m.exports;
}
const engine=load("lib/game/flappy/engine.ts");
const audit=load("lib/game/flappy/admin-review.ts",{"server-only":{},"./engine":engine});
test("admin replay checks persisted collision, score, version and digest without leaking inputs",()=>{
 const state=engine.replayFlappy(42,[],100);
 const row={status:"finalized",version:"flappy-v1",seed:42,inputs:[],tick:state.tick,collision_tick:state.tick,score:state.score,digest:createHash("sha256").update("[]").digest("hex")};
 const result=audit.summarizeFlappyAudit(row);
 assert.equal(result.replayMatches,true);assert.equal(result.humanVerification,"not_established");
 assert.equal("seed" in result,false);assert.equal("inputs" in result,false);
 for(const change of [{score:999},{tick:state.tick+1},{digest:"0".repeat(64)},{version:"unknown"},{inputs:[99]}])assert.equal(audit.summarizeFlappyAudit({...row,...change}).replayMatches,false);
 assert.equal(audit.summarizeFlappyAudit({...row,seed:null,inputs:null}).replayMatches,null);
});
test("reward panel exposes unavailable state and never grants or simulates an ad",()=>{
 const rewards=load("lib/game/flappy/rewards.ts").FLAPPY_REWARDS;
 assert.equal(rewards.extraLifeAvailable,false);assert.equal(rewards.doublePointsAvailable,false);assert.ok(Object.isFrozen(rewards));
 const ui=load("components/game/flappy-reward-options.tsx",{"@/lib/game/flappy/rewards":{FLAPPY_REWARDS:rewards}});
 const {renderToStaticMarkup}=require("react-dom/server"),{createElement}=require("react");
 const html=renderToStaticMarkup(createElement(ui.FlappyRewardOptions,{es:true}));
 assert.match(html,/EXTRA LIFE/);assert.match(html,/PRÓXIMAMENTE/);assert.match(html,/aria-expanded="false"/);
});
test("official transport sets bounded timeout and refuses unavailable service",async()=>{
 const client=load("lib/game/flappy/official-client.ts",{"./engine":engine});
 const original=globalThis.fetch;
 let calls=0;
 try{
  globalThis.fetch=async(url,options)=>{calls++;assert.ok(options.signal instanceof AbortSignal);assert.equal(options.credentials,"same-origin");assert.equal(options.body,"{}");return new Response("{}",{status:503});};
  await assert.rejects(client.startFlappyOfficial());assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});

test("admin page rejects an unauthorized request before reading evidence",async()=>{
 let queries=0;
 const sentinel=new Error("NOT_FOUND");
 const page=load("app/admin/prize-review/flappy-race/page.tsx",{
  "@/lib/security/prize-admin":{getAuthorizedPrizeAdmin:async()=>null},
  "next/navigation":{notFound:()=>{throw sentinel;}},
  "@/lib/game/flappy/admin-review":{summarizeFlappyAudit:()=>{queries++;}},
 });
 await assert.rejects(page.default({searchParams:Promise.resolve({})}),err=>err===sentinel);
 assert.equal(queries,0);
});
test("authorized admin sees a truthful unavailable state before migration; invalid pages never query",async()=>{
 let queries=0;
 const sentinel=new Error("NOT_FOUND");
 const page=load("app/admin/prize-review/flappy-race/page.tsx",{
  "@/lib/security/prize-admin":{getAuthorizedPrizeAdmin:async()=>({context:{userId:"admin"},admin:{rpc:async()=>{queries++;return{data:null,error:{code:"PGRST202"}};}}})},
  "next/navigation":{notFound:()=>{throw sentinel;}},
  "@/lib/game/flappy/admin-review":{summarizeFlappyAudit:()=>assert.fail("No fabricated rows")},
 });
 for(const params of [{page:"0"},{page:"101"},{session:"bad"}])await assert.rejects(page.default({searchParams:Promise.resolve(params)}),err=>err===sentinel);
 assert.equal(queries,0);
 const view=await page.default({searchParams:Promise.resolve({})});
 const html=require("react-dom/server").renderToStaticMarkup(view);
 assert.match(html,/Revisión no disponible temporalmente/);assert.equal(queries,1);
});

test("official client accepts server clock scheduling and rejects a missing server clock",async()=>{
 const client=load("lib/game/flappy/official-client.ts",{"./engine":engine});
 const original=globalThis.fetch;
 const session={sessionId:"11111111-1111-4111-8111-111111111111",version:"flappy-v1",seed:42,serverNow:"2026-10-26T04:00:00Z",startsAt:"2026-10-26T04:00:03Z",expiresAt:"2026-10-26T04:10:03Z"};
 try{
  globalThis.fetch=async()=>Response.json(session);assert.equal((await client.startFlappyOfficial()).serverNow,session.serverNow);
  globalThis.fetch=async()=>Response.json({...session,serverNow:undefined});await assert.rejects(client.startFlappyOfficial());
 }finally{globalThis.fetch=original;}
});
