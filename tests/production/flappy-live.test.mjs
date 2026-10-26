// Runs ONLY in the principal Vercel production build. No credentials/cookies,
// score writes, fake users, rewards or privileged operations are supplied.
import assert from "node:assert/strict";
import test from "node:test";
if(process.env.VERCEL_ENV!=="production")throw new Error("Principal Vercel production verification only");
const base="https://www.racetowin.app";
async function get(path){return fetch(base+path,{signal:AbortSignal.timeout(15000),redirect:"manual",cache:"no-store"});}
async function post(path,origin=base){return fetch(base+path,{method:"POST",signal:AbortSignal.timeout(15000),redirect:"manual",headers:{origin,"content-type":"application/json"},body:"{}"});}
test("live public Flappy status is bounded, independent and non-financial; RTW remains available",async()=>{
 const [ranking,tournament,rtw,bad]=await Promise.all([get("/api/flappy-race/leaderboard"),get("/api/flappy-race/tournament"),get("/api/leaderboard"),get("/api/flappy-race/tournament?week=bad")]);
 assert.equal(ranking.status,200);const board=await ranking.json();assert.equal(board.game,"flappy-race");assert.equal(typeof board.officialEnabled,"boolean");assert.ok(Array.isArray(board.entries));
 for(const row of board.entries)assert.deepEqual(Object.keys(row).sort(),["rank","reviewRequired","username","weeklyTotal"].sort());
 assert.equal(tournament.status,200);const closed=await tournament.json();assert.equal(closed.prizesEnabled,false);assert.equal(closed.paymentsEnabled,false);assert.ok(Array.isArray(closed.winners));
 assert.equal(rtw.status,200);assert.equal((await rtw.json()).game.slug,"race-to-win");assert.equal(bad.status,400);
});
test("live unauthenticated START/CHECKPOINT/FINALIZE and raw score POST never write",async()=>{
 const results=await Promise.all(["start","checkpoint","finalize"].map(action=>post("/api/flappy-race/sessions/"+action)));
 for(const response of results){assert.equal(response.status,401);assert.equal((await response.json()).code,"unauthenticated");}
 assert.equal((await post("/api/flappy-race/leaderboard")).status,403);
});
test("retired Flappy owner review/closure routes stay unavailable for every origin",async()=>{
 for(const route of ["/api/admin/flappy-race/review","/api/admin/flappy-race/close-week"]){
  assert.equal((await post(route)).status,404);assert.equal((await post(route,"https://invalid.example")).status,404);
 }
 assert.equal((await get("/admin/prize-review/flappy-race")).status,404);
});
