import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Real route/parser/replay + real SQL, with only the Auth/network transport replaced. */
export async function verifyLocalApi(db) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const nativeRequire = createRequire(import.meta.url);
  const cache = new Map();
  let userId = '33333333-3333-4333-8333-333333333333';
  const normalize = value => JSON.parse(JSON.stringify(value));
  const rpcNames = new Set(['rtw_read_game_session_checkpoint_proofs','rtw_finalize_game_session_with_checkpoints']);
  const admin = {
    from(table) {
      assert.equal(table, 'game_sessions');
      const filters = {};
      const query = { select: () => query, eq: (key,value) => { assert.ok(['id','user_id'].includes(key)); filters[key]=value; return query; },
        maybeSingle: async () => ({ data: normalize((await db.query('select * from public.game_sessions where id=$1 and user_id=$2',[filters.id,filters.user_id])).rows[0] ?? null), error:null }) };
      return query;
    },
    async rpc(name,args) {
      assert.ok(rpcNames.has(name));
      const keys=Object.keys(args);
      assert.ok(keys.every(key=>/^p_[a-z_]+$/.test(key)));
      const values=Object.values(args).map(value=>Array.isArray(value)?JSON.stringify(value):value);
      try { return { data:normalize((await db.query(`select * from public.${name}(${keys.map((key,i)=>`${key} => $${i+1}`).join(',')})`,values)).rows),error:null }; }
      catch(error) { return { data:null,error:{code:error.code,message:error.message} }; }
    },
  };
  const mocks = {
    'server-only': {},
    '@/lib/supabase/server': { getVerifiedUserContext: async () => userId ? { userId } : null },
    '@/lib/supabase/admin': { createAdminClient: () => admin,isAdminConfigured: () => true },
    '@/lib/observability/security-event': { createSecurityRequestId: () => 'local-fixture',logSecurityEvent() {} },
    'next/server': { NextResponse: { json: (body,init) => Response.json(body,init) } },
  };
  function load(path) {
    path=resolve(root,path);
    if(cache.has(path)) return cache.get(path).exports;
    const compiled={exports:{}}; cache.set(path,compiled);
    const output=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('exports','module','require',output)(compiled.exports,compiled,name=>{
      if(name in mocks) return mocks[name];
      if(name==='@/lib/game/race-to-win') return load('lib/game/race-to-win/index.ts');
      if(name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
      if(name.startsWith('.')) return load(resolve(dirname(path),`${name}.ts`));
      return nativeRequire(name);
    });
    return compiled.exports;
  }
  const owner=userId;
  const { POST }=load('app/api/game-sessions/finalize/route.ts');
  const { randomUUID }=nativeRequire('node:crypto');
  const sid=randomUUID();
  await db.query(`insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at)
    select $1,$2,id,'rtw-v7',1,now()-interval '5 minutes',now()+interval '5 minutes',1000,now()+interval '1 minute' from public.games where slug='race-to-win'`,[sid,owner]);
  const request = body => new Request('http://localhost/api/game-sessions/finalize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  userId=null;
  assert.equal((await POST(request({sessionId:sid,inputs:[]}))).status,401);
  userId='22222222-2222-4222-8222-222222222222';
  assert.equal((await POST(request({sessionId:sid,inputs:[]}))).status,404);
  userId=owner;
  assert.equal((await POST(request({sessionId:sid,inputs:[],score:999999}))).status,400);
  const first=await POST(request({sessionId:sid,inputs:[]}));
  assert.equal(first.status,200);
  const outcome=await first.json();
  assert.ok(Number.isInteger(outcome.score) && outcome.score>0);
  assert.deepEqual(await (await POST(request({sessionId:sid,inputs:[]}))).json(),outcome);
  assert.equal((await POST(request({sessionId:sid,inputs:[{sequence:0,atMs:100,direction:1}]}))).status,409);
  const rows=(await db.query('select score,elapsed_ms from public.validated_runs where game_session_id=$1',[sid])).rows;
  assert.equal(rows.length,1); assert.equal(rows[0].score,outcome.score); assert.equal(rows[0].elapsed_ms,outcome.elapsedMs);
  return 'PASS real FINALIZE route/parser/replay→SQL→single validated run; unauthenticated/foreign/authority rejected; exact retry canonical';
}
