import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import test from "node:test";
import ts from "typescript";
const require=createRequire(import.meta.url),source=readFileSync(new URL("../lib/game/flappy/admin-mutations.ts",import.meta.url),"utf8");
function load({authorized=true,replay=true,status="finalized",failure=false,held=false}={}){
 const calls=[],m={exports:{}};
 const rpc=async(name,args)=>{calls.push({name,args});return name==="flappy_admin_read"?{data:[{}],error:null}:{data:null,error:failure?{}:null};};
 const imports={"server-only":{},"@/lib/security/auth-401-review":{isGameAccessHeld:async()=>held},"next/server":require("next/server"),"@/lib/competition/request-body":{readBoundedJson:async r=>r.json()},"@/lib/security/prize-admin":{getAuthorizedPrizeAdmin:async()=>authorized?{context:{userId:"verified-owner"},admin:{rpc}}:null},"./admin-review":{summarizeFlappyAudit:()=>({replayMatches:replay,status,player_id:"verified-player"})},"./tournament":{parseFlappyWeek:v=>v==="2026-10-19"?v:null}};
 new Function("exports","module","require",ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m.exports,m,n=>n in imports?imports[n]:assert.fail(n));
 return {api:m.exports,calls};
}
const body={sessionId:"11111111-1111-4111-8111-111111111111",decision:"valid",note:"Reviewed evidence and automation risk",humanReviewed:true};
function request(b=body,origin="https://test"){return new Request("https://test/api",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(b)});}
test("admin mutations reject CSRF and unauthorized callers without reading evidence",async()=>{
 const a=load();assert.equal((await a.api.mutateFlappyAdmin("review",request(body,"https://evil"))).status,403);assert.equal(a.calls.length,0);
 const b=load({authorized:false});assert.equal((await b.api.mutateFlappyAdmin("review",request())).status,404);assert.equal(b.calls.length,0);
});
test("approval requires replay and explicit human review; browser cannot supply actor or score",async()=>{
 for(const change of [{humanReviewed:false},{actor:"forged"},{score:999},{note:""}]){const a=load();assert.equal((await a.api.mutateFlappyAdmin("review",request({...body,...change}))).status,400);assert.equal(a.calls.length,0);}
 const bad=load({replay:false});assert.equal((await bad.api.mutateFlappyAdmin("review",request())).status,409);assert.equal(bad.calls.length,1);
 const good=load();assert.equal((await good.api.mutateFlappyAdmin("review",request())).status,200);assert.equal(good.calls[1].args.p_actor,"verified-owner");assert.equal("p_score" in good.calls[1].args,false);
 const reject=load({replay:false});assert.equal((await reject.api.mutateFlappyAdmin("review",request({...body,decision:"disqualified"}))).status,200);
});
test("closed/review-conflict errors stay fail-closed and closure uses the verified actor",async()=>{
 const failure=load({failure:true});assert.equal((await failure.api.mutateFlappyAdmin("review",request())).status,409);
 const closure=load();assert.equal((await closure.api.mutateFlappyAdmin("close-week",request({week:"2026-10-19",confirmed:true}))).status,200);assert.deepEqual(closure.calls[0],{name:"flappy_close_week",args:{p_actor:"verified-owner",p_week:"2026-10-19"}});
 const invalid=load();assert.equal((await invalid.api.mutateFlappyAdmin("close-week",request({week:"bad",confirmed:true}))).status,400);assert.equal(invalid.calls.length,0);
});

test("a held player cannot be approved even when the replay matches",async()=>{
 const a=load({held:true});assert.equal((await a.api.mutateFlappyAdmin("review",request())).status,409);assert.equal(a.calls.length,1);
});
