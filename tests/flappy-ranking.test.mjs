import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
const root=new URL("../",import.meta.url);
const source=await readFile(new URL("lib/competition/flappy-ranking.ts",root),"utf8");
const routeSource=await readFile(new URL("app/api/flappy-race/leaderboard/route.ts",root),"utf8");
function compile(text,require){
 const mod={exports:{}};new Function("exports","module","require",ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(mod.exports,mod,require);return mod.exports;
}
function reader({entries=[],next=false,error=null,data,codeEnabled=false,dbEnabled=false}={}){
 const calls=[];
 const api=compile(source,name=>name==="server-only"?{}:name.endsWith("/scores")?{currentNewYorkTournamentWeek:()=>"2026-10-19"}:
 name.endsWith("/activation")?{FLAPPY_COMPETITION_ENABLED:codeEnabled}:name.endsWith("/admin")?{createAdminClient:()=>({
 from(){assert.fail("Flappy must not query shared RTW totals or profiles");},
 async rpc(name,args){assert.equal(name,"flappy_read_ranking");assert.deepEqual(args,{p_week:"2026-10-19",p_page:1});calls.push([name,args]);return {data:data??{entries,hasNextPage:next,officialEnabled:dbEnabled},error};}
 })}:assert.fail(name));
 return {api,calls};
}
test("Flappy pagination rejects client game, score, player and week selection",()=>{
 const {api}=reader();assert.equal(api.parseFlappyPage(new URLSearchParams()),1);
 for(const q of ["page=0","page=101","page=01","page=1&page=2","game=race-to-win","score=999","week=2026-10-19","player=x"])assert.equal(api.parseFlappyPage(new URLSearchParams(q)),null);
});
test("Flappy reads only its private RPC even when official mode is closed",async()=>{
 const {api,calls}=reader();const board=await api.readFlappyRanking(1);
 assert.deepEqual(board,{game:"flappy-race",tournamentWeek:"2026-10-19",page:1,hasNextPage:false,officialEnabled:false,entries:[]});assert.equal(calls.length,1);
});
test("approved Flappy entries preserve ties and expose only public ranking fields",async()=>{
 const {api}=reader({entries:[{rank:1,username:"Existing",weeklyTotal:200,reviewRequired:false,player_id:"private"},{rank:null,username:"Tied",weeklyTotal:100,reviewRequired:true}]});
 const board=await api.readFlappyRanking(1);assert.equal(board.entries[1].rank,null);assert.equal("player_id" in board.entries[0],false);assert.equal(board.entries[0].weeklyTotal,200);
});
test("malformed metadata, numeric overflow and RPC failures fail closed",async()=>{
 for(const row of [{rank:1,username:"A",weeklyTotal:-1,reviewRequired:false},{rank:1,username:"A",weeklyTotal:24501,reviewRequired:false},{rank:1,username:"A",weeklyTotal:1,reviewRequired:true},{rank:null,username:"A",weeklyTotal:1,reviewRequired:false}])await assert.rejects(reader({entries:[row]}).api.readFlappyRanking(1));
 await assert.rejects(reader({error:{message:"private"}}).api.readFlappyRanking(1));
 await assert.rejects(reader({data:{entries:[],hasNextPage:"false"}}).api.readFlappyRanking(1));
 await assert.rejects(reader().api.readFlappyRanking(101));
});
function route({ configured = true, read = async () => ({ entries: [], game: "flappy-race" }) } = {}) {
  const { api } = reader();
  return compile(routeSource, name => name === "next/server" ? { NextResponse: { json: (data, options = {}) => ({ data, status: options.status ?? 200, headers: options.headers }) } } :
    name.endsWith("/flappy-ranking") ? { ...api, readFlappyRanking: read } :
    name.endsWith("/admin") ? { isAdminConfigured: () => configured } : assert.fail(name));
}
test("manipulated and duplicate POST submissions are always denied without reading bodies or touching storage", async () => {
  let reads = 0;
  const api = route({ read: async () => { reads++; assert.fail("score storage called"); } });
  const request = { json() { assert.fail("untrusted body should not be consumed"); } };
  for (let i = 0; i < 3; i++) {
    const result = await api.POST(request);
    assert.equal(result.status, 403);
    assert.equal(result.data.code, "FLAPPY_OFFICIAL_DISABLED");
    assert.equal(result.headers["Cache-Control"], "private, no-store");
  }
  assert.equal(reads, 0);
});
test("ranking GET validates requests and fails closed on missing configuration or DB failure", async () => {
  assert.equal((await route().GET(new Request("https://test/api?game=race-to-win"))).status, 400);
  assert.equal((await route({ configured: false }).GET(new Request("https://test/api"))).status, 503);
  assert.equal((await route({ read: async () => { throw new Error("private database detail"); } }).GET(new Request("https://test/api"))).status, 503);
  assert.equal((await route().GET(new Request("https://test/api"))).status, 200);
});
test("shared weekly materializer retains daily top seven, NY dates and score-vector ties", async () => {
  const sql = await readFile(new URL("supabase/migrations/20260907000100_create_competition_foundation.sql", root), "utf8");
  assert.match(sql, /America\/New_York/);
  assert.match(sql, /ranked\.daily_rank <= 7/);
  assert.match(sql, /sum\(daily\.score\)/i);
  assert.match(sql, /array_agg\(run\.score order by run\.score desc,/i);
  assert.match(sql, /exact_tie/);
  // These are source-contract checks. SQL execution/RLS in production is not claimed.
});
test("Flappy UI renders public rows, review ties and podium classes without sample production data", async () => {
  const component = await readFile(new URL("components/scores/flappy-ranking.tsx", root), "utf8");
  const board = { game: "flappy-race", tournamentWeek: "2026-10-19", page: 1, hasNextPage: false, officialEnabled: false,
    entries: [{ rank: 1, username: "<Existing>", weeklyTotal: 123, reviewRequired: false },
      { rank: null, username: "Tied", weeklyTotal: 100, reviewRequired: true }] };
  let index = 0;
  const api = compile(component, name => name === "react" ? {
    useEffect() {}, useState() { return [[1, board, false][index++], () => {}]; },
  } : name === "react/jsx-runtime" ? jsx : assert.fail(name));
  const html = renderToStaticMarkup(jsx.jsx(api.FlappyRankingTable, { language: "es" }));
  assert.match(html, /ranking-row--1/);
  assert.match(html, /&lt;Existing&gt;/);
  assert.match(html, /Empate absoluto/);
  assert.doesNotMatch(html, /ranking-row--null/);
  assert.match(html, /no se guardan en el ranking/);
});

test("public availability requires both the reviewed code and effective database gates",async()=>{
 for(const [codeEnabled,dbEnabled,expected] of [[true,true,true],[true,false,false],[false,true,false]]){
  assert.equal((await reader({codeEnabled,dbEnabled}).api.readFlappyRanking(1)).officialEnabled,expected);
 }
});
