import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Exercise the real renderer lifecycle without requiring a GPU or asset downloads.
const require = createRequire(import.meta.url);
function loadWorld(source) {
 const counters = {created:0, disposed:0};
 const makeVisual = (model=false) => {
  counters.created++;
  return {root:{userData:{rtwModelVehicle:model},visible:true,position:{set(){}}},chassis:{position:{y:0},rotation:{z:0}},wheels:[]};
 };
 const module = {exports:{}};
 const imports = {
  "three":{},
  "./environment":{},
  "./city":{},
  "./vehicles":{createTrafficVehicle:()=>makeVisual()},
  "./model-vehicles":{
   createModelVehicleVisual:()=>makeVisual(true),
   isModelVehicleVisual:v=>v.root.userData.rtwModelVehicle,
   disposeModelVehicleVisual:()=>{counters.disposed++},
  },
 };
 new Function("require","module","exports",ts.transpileModule(source,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
 }).outputText)(name=>imports[name],module,module.exports);
 const world=Object.create(module.exports.RaceToWinWorld.prototype);
 Object.assign(world,{quality:{trafficLimit:18},vehicleAssets:{},vehicleTemplates:{traffic:Array(6).fill({})},
  trafficVisuals:new Map(),trafficVisualPool:[],scene:{children:new Set(),add(root){this.children.add(root)},remove(root){this.children.delete(root)}}});
 return {world,counters};
}
const car=(id,variantIndex=0,distance=30)=>({id,variantIndex,relativeDistance:distance,laneX:0,speedMps:0});
const source=readFileSync(new URL("../lib/game/race-to-win/world.ts",import.meta.url),"utf8");
test("long runs keep traffic allocations and retained scene objects bounded",()=>{
 const {world,counters}=loadWorld(source);
 for(let id=0;id<10000;id++)world.updateTraffic([car(id,id%6)],100,1/60);
 assert.equal(world.trafficVisuals.size,1);
 assert.equal(world.scene.children.size,1);
 assert.ok(counters.created<=7,`created ${counters.created} visuals instead of reusing the six variants`);
 assert.ok(world.trafficVisualPool.length<=18);
 world.clearTrafficVisuals();
 assert.equal(counters.disposed,counters.created);
 assert.equal(world.scene.children.size,0);
});
test("nearest cars remain visible when the traffic limit is reached",()=>{
 const {world}=loadWorld(source);
 world.quality.trafficLimit=2;
 world.updateTraffic([car(1,0,200),car(2,1,20),car(3,2,5)],100,1/60);
 assert.deepEqual([...world.trafficVisuals.keys()],[3,2]);
 world.updateTraffic([car(4,3,40),car(5,4,8)],100,1/60);
 assert.deepEqual([...world.trafficVisuals.keys()],[5,4]);
 assert.equal(world.scene.children.size,2);
});
test("overflow and reset release model materials exactly once",()=>{
 const {world,counters}=loadWorld(source);
 world.quality.trafficLimit=2;
 for(let id=0;id<100;id+=2)world.updateTraffic([car(id,id%6),car(id+1,(id+1)%6)],100,1/60);
 assert.ok(world.trafficVisualPool.length<=2);
 world.clearTrafficVisuals();
 assert.equal(counters.disposed,counters.created);
 assert.equal(world.trafficVisuals.size,0);
 assert.equal(world.trafficVisualPool.length,0);
});
