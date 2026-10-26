import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(path, imports = {}) {
 const m = { exports: {} };
 new Function("module", "exports", "require", ts.transpileModule(readFileSync(new URL("../" + path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(m, m.exports, name => name in imports ? imports[name] : require(name));
 return m.exports;
}
const availability = load("lib/game/flappy/availability.ts");
const client = load("lib/game/flappy/official-client.ts", { "./engine": { FLAPPY_VERSION: "flappy-v1" }, "./availability": availability });
test("availability transport validates server data and distinguishes network, auth, limit, active and server failures", async () => {
 const original = globalThis.fetch;
 try {
  for (const code of ["unauthenticated", "attempts_exhausted", "session_active", "service_unavailable", "rate_limited"]) {
   globalThis.fetch = async () => Response.json({code}, {status: code === "unauthenticated" ? 401 : 503});
   await assert.rejects(client.readFlappyAvailability(), error => error.code === code);
  }
  globalThis.fetch = async () => { throw new TypeError("offline"); };
  await assert.rejects(client.startFlappyOfficial(), error => error.code === "connection_error");
  const data = {limit:5, remaining:3, serverNow:"2026-10-26T12:00:00Z", nextAvailableAt:"2026-10-26T12:24:35Z", activeUntil:null};
  globalThis.fetch = async (url, options) => { assert.equal(url, "/api/flappy-race/opportunities"); assert.equal(options.method, "GET"); assert.equal(options.body, undefined); return Response.json(data); };
  assert.deepEqual(await client.readFlappyAvailability(), data);
  for (const bad of [{...data,remaining:6}, {...data,serverNow:"bad"}, {...data,nextAvailableAt:null}]) assert.throws(() => availability.parseFlappyAvailability(bad));
 } finally { globalThis.fetch = original; }
});
test("availability route binds reads to verified identity and rejects unauthenticated requests before database access", async () => {
 let user = null, calls = 0;
 const route = load("app/api/flappy-race/opportunities/route.ts", {
  "@/lib/supabase/server": { getVerifiedUserContext:async () => user },
  "@/lib/supabase/admin": { createAdminClient: () => ({rpc:async (name,args) => {calls++;assert.equal(name,"flappy_read_availability");assert.deepEqual(args,{p_player:"verified-player"});return {data:{limit:5,remaining:5,serverNow:new Date().toISOString(),nextAvailableAt:null,activeUntil:null},error:null};}}) },
  "@/lib/game/flappy/server": {flappyPlayerAccess:async () => "allowed"},
  "@/lib/game/flappy/activation": {FLAPPY_COMPETITION_ENABLED:true},
  "@/lib/game/flappy/availability": availability,
 });
 assert.equal((await route.GET()).status,401); assert.equal(calls,0);
 user={userId:"verified-player"}; const response=await route.GET();assert.equal(response.status,200);assert.equal(calls,1);assert.match(response.headers.get("cache-control"),/no-store/);
});
