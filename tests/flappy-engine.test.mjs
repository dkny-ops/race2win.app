import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(path, imports = {}) {
  const source = readFileSync(new URL("../"+path, import.meta.url),"utf8");
  const module = { exports:{} };
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function("module","exports","require",code)(module,module.exports,name=>name in imports?imports[name]:require(name));
  return module.exports;
}
const e=load("lib/game/flappy/engine.ts");
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
const bounded=load("lib/competition/request-body.ts",{"server-only":{}});
const api=load("lib/game/flappy/server.ts",{
 "server-only":{},"@/lib/competition/request-body":bounded,
 "@/lib/supabase/admin":{createAdminClient:()=>assert.fail("unconfigured database")},
 "@/lib/supabase/server":{getVerifiedUserContext:async()=>null},
 "./activation":{FLAPPY_COMPETITION_ENABLED:false},"./engine":e,
});
function req(body){return new Request("https://test/api",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});}
test("official endpoints remain locked by reviewed code and require live identity",async()=>{
  const db=()=>assert.fail("closed endpoint must not access DB");
  assert.equal((await api.handleFlappy("start",req({}),{enabled:false,user:async()=>null,admin:db,now:Date.now})).status,401);
  assert.equal((await api.handleFlappy("start",req({}),{enabled:false,user:async()=>"player",admin:db,now:Date.now})).status,403);
});
test("authority fields, wrong seeds, forged score and hostile origins cannot enter session APIs",async()=>{
  const deps={enabled:true,user:async()=>"player",admin:()=>({rpc:async()=>({data:true,error:null})}),now:Date.now};
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
