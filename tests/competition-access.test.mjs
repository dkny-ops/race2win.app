import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(env, rpc = async () => ({data:"allowed",error:null})) {
  const m = {exports:{}};
  const source = ts.transpileModule(readFileSync(new URL("../lib/security/competition-access.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function("exports","require","process",source)(m.exports,name => name === "server-only" ? {} : name === "@/lib/supabase/admin" ? {createAdminClient:()=>({rpc})} : require(name),{env});
  return m.exports;
}
test("network evidence trusts only the Vercel client header and rotates daily",()=>{
 const api=load({VERCEL:"1",RTW_ABUSE_HMAC_KEY:"x".repeat(32)});
 const request=new Request("https://test",{headers:{"x-vercel-forwarded-for":"203.0.113.7","x-forwarded-for":"198.51.100.9"}});
 const day=new Date("2026-10-26T10:00:00Z");
 const hash=api.networkEvidenceHmac(request,day);
 assert.match(hash,/^[0-9a-f]{64}$/);
 assert.equal(api.networkEvidenceHmac(request,day),hash);
 assert.notEqual(api.networkEvidenceHmac(request,new Date("2026-10-27T10:00:00Z")),hash);
 request.headers.set("x-forwarded-for","1.1.1.1");assert.equal(api.networkEvidenceHmac(request,day),hash);
 request.headers.delete("x-vercel-forwarded-for");assert.equal(api.networkEvidenceHmac(request,day),null);
 request.headers.set("x-vercel-forwarded-for","203.0.113.7, 1.1.1.1");assert.equal(api.networkEvidenceHmac(request,day),null);
 assert.equal(load({RTW_ABUSE_HMAC_KEY:"x".repeat(32)}).networkEvidenceHmac(request,day),null);
});
test("identity service errors and unknown decisions fail closed",async()=>{
 const request=new Request("https://test");
 for(const result of [{data:true,error:null},{data:"allowed",error:{message:"private"}},{data:null,error:null}]) {
  assert.equal(await load({},async()=>result).recordCompetitionAccess("player","race-to-win",request),"unavailable");
 }
 for(const status of ["allowed","identity_conflict","verified_email_required"]) {
  assert.equal(await load({},async()=>({data:status,error:null})).recordCompetitionAccess("player","flappy-race",request),status);
 }
});
