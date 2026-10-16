import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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
  const securityEvents = [];
  const replayCalls = [];
  const rpcNames = new Set([
    'rtw_read_game_session_checkpoint_proofs',
    'rtw_finalize_game_session_with_checkpoints',
    'rtw_record_game_session_checkpoint_with_lease',
    'rtw_start_official_game_session_v3',
    'rtw_start_official_game_session_v4',
    'rtw_consume_competition_action_rate_limit',
    'rtw_begin_prize_claim',
    'rtw_begin_balance_payout_request',
    'rtw_attach_referral',
    'rtw_read_public_leaderboard_page_metadata',
  ]);
  const rpcFailures = [];
  const admin = {
    from(table) {
      assert.ok(['game_sessions', 'games'].includes(table));
      const filters = {};
      const query = { select: () => query, eq: (key,value) => { assert.ok(['id','user_id','slug','status'].includes(key)); filters[key]=value; return query; },
        maybeSingle: async () => {
          const tableFilters = Object.entries(filters);
          const where = tableFilters.map(([key],index)=>`${key}=$${index+1}`).join(' and ');
          const values = tableFilters.map(([,value])=>value);
          return { data: normalize((await db.query(`select * from public.${table}${where ? ` where ${where}` : ''}`,values)).rows[0] ?? null), error:null };
        } };
      return query;
    },
    async rpc(name,args) {
      assert.ok(rpcNames.has(name));
      const keys=Object.keys(args);
      assert.ok(keys.every(key=>/^p_[a-z_]+$/.test(key)));
      const values=Object.values(args).map(value=>Array.isArray(value)?JSON.stringify(value):value);
      try {
        const result = await db.query(`select * from public.${name}(${keys.map((key,i)=>`${key} => $${i+1}`).join(',')})`,values);
        if ([
          'rtw_consume_competition_action_rate_limit',
          'rtw_begin_prize_claim',
          'rtw_begin_balance_payout_request',
          'rtw_attach_referral',
          'rtw_read_public_leaderboard_page_metadata',
        ].includes(name)) return { data: result.rows[0]?.[name] ?? null, error: null };
        return { data: normalize(result.rows), error: null };
      }
      catch(error) { rpcFailures.push({ name, code: error.code, message: error.message }); return { data:null,error:{code:error.code,message:error.message} }; }
    },
  };
  const mocks = {
    'server-only': {},
    '@/lib/supabase/server': { getVerifiedUserContext: async () => userId ? { userId } : null },
    '@/lib/supabase/admin': { createAdminClient: () => admin,isAdminConfigured: () => true },
    '@/lib/competition/server': {
      getVerifiedPlayerId: async () => userId,
      getWhatsAppClaimUrl: () => 'https://example.invalid/synthetic-claim',
      RACE_TO_WIN_GAME_SLUG: 'race-to-win',
      isUuid: value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
      NO_STORE_HEADERS: { 'Cache-Control': 'no-store' },
      readBoundedJson: async request => { try { return await request.json(); } catch { return null; } },
      hasEmptyBoundedBody: async request => (await request.text()).length === 0,
      normalizeReferralCode: value => typeof value === 'string' ? value.trim().toUpperCase() : null,
      consumeCompetitionActionRateLimit: async (playerId, action) => {
        if (playerId !== userId) return null;
        const result = await admin.rpc('rtw_consume_competition_action_rate_limit', { p_player_id: playerId, p_action: action });
        return result.error ? null : result.data;
      },
    },
    '@/lib/observability/security-event': { createSecurityRequestId: () => 'local-fixture',logSecurityEvent(event) { securityEvents.push(event); } },
    'next/server': { NextResponse: { json: (body,init) => Response.json(body,init) } },
  };
  function load(path) {
    path=resolve(root,path);
    if(cache.has(path)) return cache.get(path).exports;
    const compiled={exports:{}}; cache.set(path,compiled);
    const output=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('exports','module','require',output)(compiled.exports,compiled,name=>{
      if(name in mocks) return mocks[name];
      if(name==='@/lib/game/race-to-win') {
        const gameModule=load('lib/game/race-to-win/index.ts');
        return { ...gameModule, replayAuthoritativeProgress(...args) {
          const result=gameModule.replayAuthoritativeProgress(...args);
          replayCalls.push({ args, result });
          return result;
        } };
      }
      if(name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
      if(name.startsWith('.')) return load(resolve(dirname(path),`${name}.ts`));
      return nativeRequire(name);
    });
    return compiled.exports;
  }
  const owner=userId;
  const { POST }=load('app/api/game-sessions/finalize/route.ts');
  const { POST: checkpointPOST }=load('app/api/game-sessions/checkpoint/route.ts');
  const { POST: startPOST }=load('app/api/game-sessions/start/route.ts');
  const { GET: leaderboardGET }=load('app/api/leaderboard/route.ts');
  const { POST: prizeClaimPOST }=load('app/api/prizes/claim/route.ts');
  const { POST: balanceClaimPOST }=load('app/api/prizes/balance-claim/route.ts');
  const { POST: referralAttachPOST }=load('app/api/referrals/attach/route.ts');
  const { replayAuthoritativeProgress, replayAuthoritativeRace }=load('lib/game/race-to-win/authoritative-replay.ts');
  const handlers = new Map([
    ['/api/game-sessions/start', startPOST],
    ['/api/game-sessions/checkpoint', checkpointPOST],
    ['/api/game-sessions/finalize', POST],
    ['/api/leaderboard', leaderboardGET],
    ['/api/prizes/claim', prizeClaimPOST],
    ['/api/prizes/balance-claim', balanceClaimPOST],
    ['/api/referrals/attach', referralAttachPOST],
  ]);
  const syntheticUsers = new Map([
    ['local-owner-cookie', owner],
    ['local-attacker-cookie', '22222222-2222-4222-8222-222222222222'],
    ['local-rate-cookie', '55555555-5555-4555-8555-555555555555'],
  ]);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');
      const handler = handlers.get(url.pathname);
      if (!handler) { outgoing.writeHead(404).end(); return; }
      const cookie = incoming.headers.cookie?.match(/(?:^|;\s*)rtw_local_session=([^;]+)/)?.[1] ?? '';
      userId = syntheticUsers.get(cookie) ?? null;
      const chunks = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, {
        method: incoming.method,
        headers: incoming.headers,
        ...(body ? { body } : {}),
      });
      const response = incoming.method === 'GET' ? await handler(request) : await handler(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500).end();
    }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let offensiveHttpRequests = 0;
  const offensiveHttpStatuses = [];
  const httpRequest = async (path, { body, cookie, headers = {}, method = 'POST', attack = true } = {}) => {
    if (attack) offensiveHttpRequests += 1;
    const requestHeaders = new Headers(headers);
    if (cookie) requestHeaders.set('Cookie', `rtw_local_session=${cookie}`);
    // The local HTTP bridge intentionally reconstructs Request URLs without a
    // port; mirror that exact origin for the route's CSRF assertion.
    if (['/api/game-sessions/start', '/api/referrals/attach'].includes(path) && !requestHeaders.has('Origin')) requestHeaders.set('Origin', 'http://127.0.0.1');
    if (body !== undefined && !requestHeaders.has('Content-Type')) requestHeaders.set('Content-Type', 'application/json');
    const response=await fetch(`${baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    if(attack) offensiveHttpStatuses.push(response.status);
    return response;
  };
  try {
  const { randomUUID }=nativeRequire('node:crypto');
  const ratePlayer='55555555-5555-4555-8555-555555555555';
  await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())',[ratePlayer]);
  const gameId=(await db.query("select id from public.games where slug='race-to-win'")).rows[0].id;
  await db.query('insert into public.referral_codes(owner_user_id,game_id,code) values($1,$2,$3)',['11111111-1111-4111-8111-111111111111',gameId,'SYNTHETIC001']);
  const start=await httpRequest('/api/game-sessions/start',{body:{startedAt:'2099-01-01T00:00:00Z'},headers:{'Idempotency-Key':randomUUID()},cookie:'local-owner-cookie'});
  assert.equal(start.status,200);
  const started=await start.json();
  assert.notEqual(Date.parse(started.startsAt),Date.parse('2099-01-01T00:00:00Z'));
  const startedRow=(await db.query('select started_at,referral_eligible from public.game_sessions where id=$1',[started.sessionId])).rows[0];
  assert.ok(Math.abs(Date.parse(startedRow.started_at)-Date.parse(started.startsAt))<1000);
  assert.equal(startedRow.referral_eligible,false);
  const invalidWeek=await httpRequest('/api/leaderboard?week=2099-02-10&page=1&pageSize=25',{method:'GET'});
  assert.equal(invalidWeek.status,400);
  const boundedLeaderboard=await httpRequest('/api/leaderboard?week=2099-02-09&page=101&pageSize=999',{method:'GET'});
  assert.equal(boundedLeaderboard.status,400);
  const leaderboard=await httpRequest('/api/leaderboard?week=2099-02-09&page=1&pageSize=25',{method:'GET',attack:false});
  assert.equal(leaderboard.status,200);
  const anonymousClaim=await httpRequest('/api/prizes/claim',{body:{winnerId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}});
  assert.equal(anonymousClaim.status,401);
  const playerClaim=await httpRequest('/api/prizes/claim',{body:{winnerId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},cookie:'local-owner-cookie'});
  assert.equal(playerClaim.status,409);
  const playerBalanceClaim=await httpRequest('/api/prizes/balance-claim',{cookie:'local-owner-cookie'});
  assert.equal(playerBalanceClaim.status,409);
  const awardState=(await db.query(`select
    (select count(*) from public.provisional_winners where player_id=$1) winners,
    (select count(*) from public.prize_ledger_entries where player_id=$1) ledger,
    (select count(*) from public.prize_balances where player_id=$1) balances,
    (select count(*) from public.payouts where player_id=$1) payouts`,[owner])).rows[0];
  assert.deepEqual(Object.values(awardState).map(Number),[0,0,0,0]);
  const sid=randomUUID();
  await db.query(`insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at)
    select $1,$2,id,'rtw-v7',1,now()-interval '5 minutes',now()+interval '5 minutes',1000,now()+interval '1 minute' from public.games where slug='race-to-win'`,[sid,owner]);
  const finalizePath = '/api/game-sessions/finalize';
  const baseBody = { sessionId: sid, inputs: [] };
  assert.equal((await httpRequest('/api/game-sessions/start')).status,401);
  assert.equal((await httpRequest(finalizePath,{body:baseBody,headers:{Authorization:'Bearer local-owner-cookie'}})).status,401);
  assert.equal((await httpRequest(finalizePath,{body:baseBody,cookie:'invalid.jwt.value'})).status,401);
  assert.equal((await httpRequest(finalizePath,{body:{...baseBody,score:999999},cookie:'local-owner-cookie'})).status,400);
  for (const forged of [
    { score: -1 }, { score: 1.5 }, { score: 999999999 },
    { distanceMillimeters: -1 }, { distanceMillimeters: 1.5 }, { distanceMillimeters: 1 },
    { elapsedMs: -1 }, { elapsedMs: 1.5 }, { elapsedMs: 1 },
    { collisionAtMs: -1 }, { collisionAtMs: 999999999 },
    { inputDigest: 'f'.repeat(64) },
  ]) assert.equal((await httpRequest(finalizePath,{body:{...baseBody,...forged},cookie:'local-owner-cookie'})).status,400);
  for (const inputs of [
    [{sequence:1,atMs:0,direction:1}],
    [{sequence:0,atMs:-1,direction:1}],
    [{sequence:0,atMs:0,direction:0}],
    [{sequence:0,atMs:0,direction:1,score:999999}],
    Array.from({length:4097},(_,sequence)=>({sequence,atMs:0,direction:1})),
  ]) assert.equal((await httpRequest(finalizePath,{body:{sessionId:sid,inputs},cookie:'local-owner-cookie'})).status,400);
  assert.equal((await httpRequest(finalizePath,{body:baseBody,cookie:'local-attacker-cookie'})).status,404);
  assert.equal(Number((await db.query('select count(*) n from public.validated_runs where game_session_id=$1',[sid])).rows[0].n),0);
  assert.equal((await db.query('select status from public.game_sessions where id=$1',[sid])).rows[0].status,'active');
  const first=await httpRequest(finalizePath,{body:baseBody,cookie:'local-owner-cookie',attack:false});
  assert.equal(first.status,200,JSON.stringify(rpcFailures));
  const outcome=await first.json();
  assert.ok(Number.isInteger(outcome.score) && outcome.score>0);
  assert.deepEqual(await (await httpRequest(finalizePath,{body:baseBody,cookie:'local-owner-cookie'})).json(),outcome);
  assert.equal((await httpRequest(finalizePath,{body:{sessionId:sid,inputs:[{sequence:0,atMs:100,direction:1}]},cookie:'local-owner-cookie'})).status,409);
  const rows=(await db.query('select score,elapsed_ms from public.validated_runs where game_session_id=$1',[sid])).rows;
  assert.equal(rows.length,1); assert.equal(rows[0].score,outcome.score); assert.equal(rows[0].elapsed_ms,outcome.elapsedMs);
  const attached=await httpRequest('/api/referrals/attach',{body:{code:'SYNTHETIC001'},cookie:'local-owner-cookie'});
  assert.equal(attached.status,200,JSON.stringify(rpcFailures));
  assert.equal((await httpRequest('/api/referrals/attach',{body:{code:'SYNTHETIC001'},cookie:'local-owner-cookie',headers:{Origin:'https://attacker.invalid'}})).status,403);
  const referralId=(await db.query('select id from public.referrals where invitee_user_id=$1',[owner])).rows[0].id;
  const automatedSessionIds=[];
  const automatedStarts=await Promise.all(Array.from({length:3},()=>httpRequest('/api/game-sessions/start',{headers:{'Idempotency-Key':randomUUID()},cookie:'local-owner-cookie'})));
  assert.ok(automatedStarts.every(response=>response.status===200));
  const startRecords=await Promise.all(automatedStarts.map(response=>response.json()));
  for (const startRecord of startRecords) automatedSessionIds.push(startRecord.sessionId);
  const runHorizons=startRecords.map(startRecord=>{
    let outcome=null;
    for(let cap=1000;cap<=120000&&!outcome;cap+=250) outcome=replayAuthoritativeRace('rtw-v7',Number(startRecord.seed),[],cap);
    assert.ok(outcome,'Synthetic seed did not collide within two minutes.');
    return Date.parse(startRecord.startsAt)+outcome.elapsedMs;
  });
  const waitMs=Math.max(...runHorizons)-Date.now()+1500;
  if(waitMs>0) await new Promise(resolveWait=>setTimeout(resolveWait,waitMs));
  for (const automatedSessionId of automatedSessionIds) {
    const automatedFinalize=await httpRequest(finalizePath,{body:{sessionId:automatedSessionId,inputs:[]},cookie:'local-owner-cookie'});
    assert.equal(automatedFinalize.status,200,await automatedFinalize.text());
  }
  const originalAttackRows=(await db.query('select score,eligibility_status,referral_eligible from public.validated_runs where game_session_id=any($1::uuid[]) order by game_session_id',[automatedSessionIds])).rows;
  assert.equal(originalAttackRows.length,3);
  assert.ok(originalAttackRows.every(row=>row.eligibility_status==='valid' && row.referral_eligible===false));
  let referralState=(await db.query('select qualified_day_count,status from public.referrals where id=$1',[referralId])).rows[0];
  assert.equal(referralState.qualified_day_count,0);
  assert.equal(Number((await db.query('select count(*) n from public.referral_qualification_days where referral_id=$1',[referralId])).rows[0].n),0);

  const repeatedInputs=Array.from({length:16},(_,index)=>({sequence:index,atMs:300+index*500,direction:1}));
  const alternatingInputs=Array.from({length:20},(_,index)=>({sequence:index,atMs:300+index*500,direction:index%2?-1:1}));
  const noImpactInputs=[{sequence:0,atMs:300,direction:-1}];
  const patternCases=[
    {seed:1,inputs:repeatedInputs,expectReferralEligible:false},
    {seed:1,inputs:alternatingInputs,expectReferralEligible:false},
    {seed:1,inputs:noImpactInputs,expectReferralEligible:false},
  ];
  const patternSessionIds=[];
  const patternHorizons=[];
  const patternPayloads=[];
  for(const attackCase of patternCases) {
    const sessionId=randomUUID(); patternSessionIds.push(sessionId);
    const inserted=(await db.query(`insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at)
      values($1,$2,$3,'rtw-v7',$4,now()+interval '3 seconds',now()+interval '10 minutes',1000,now()+interval '6 minutes') returning started_at`,[sessionId,owner,gameId,attackCase.seed])).rows[0];
    const prediction=replayAuthoritativeProgress('rtw-v7',attackCase.seed,attackCase.inputs,120000);
    assert.ok(prediction?.state==='crashed');
    const inputs=attackCase.inputs.filter(input=>input.atMs<=prediction.elapsedMs);
    const progress=replayAuthoritativeProgress('rtw-v7',attackCase.seed,inputs,120000);
    assert.ok(progress?.state==='crashed');
    const baseline=replayAuthoritativeProgress('rtw-v7',attackCase.seed,[],progress.elapsedMs);
    assert.equal(load('lib/game/race-to-win/authoritative-replay.ts').hasMeaningfulReferralEvidence(progress,baseline),false);
    patternHorizons.push(Date.parse(inserted.started_at)+progress.elapsedMs);
    patternPayloads.push({sessionId,inputs,expectReferralEligible:attackCase.expectReferralEligible});
  }
  const patternWait=Math.max(...patternHorizons)-Date.now()+1500;
  if(patternWait>0) await new Promise(resolveWait=>setTimeout(resolveWait,patternWait));
  for(const pattern of patternPayloads) {
    const finalized=await httpRequest(finalizePath,{body:{sessionId:pattern.sessionId,inputs:pattern.inputs},cookie:'local-owner-cookie'});
    const sessionTiming=(await db.query('select seed,started_at from public.game_sessions where id=$1',[pattern.sessionId])).rows[0];
    const elapsedCap=Math.max(0,Math.floor(Date.now()-Date.parse(sessionTiming.started_at)));
    const timingReplay=replayAuthoritativeProgress('rtw-v7',Number(sessionTiming.seed),pattern.inputs,elapsedCap);
    assert.equal(finalized.status,200,JSON.stringify({response:await finalized.text(),elapsedCap,progress:timingReplay,routeReplay:replayCalls.slice(-2),events:securityEvents.slice(-3)}));
    assert.equal((await db.query('select referral_eligible from public.game_sessions where id=$1',[pattern.sessionId])).rows[0].referral_eligible,pattern.expectReferralEligible);
    assert.equal((await httpRequest(finalizePath,{body:{sessionId:pattern.sessionId,inputs:pattern.inputs},cookie:'local-owner-cookie'})).status,200);
  }
  const storedPatternRuns=(await db.query('select eligibility_status,referral_eligible from public.validated_runs where game_session_id=any($1::uuid[])',[patternSessionIds])).rows;
  assert.equal(storedPatternRuns.length,3);
  assert.ok(storedPatternRuns.every(row=>row.eligibility_status==='valid' && row.referral_eligible===false));
  const impossibleId=randomUUID();
  await db.query(`insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at)
    values($1,$2,$3,'rtw-v7',1,now()-interval '1 minute',now()+interval '5 minutes',1000,now()+interval '1 minute')`,[impossibleId,owner,gameId]);
  assert.equal((await httpRequest(finalizePath,{body:{sessionId:impossibleId,inputs:[{sequence:0,atMs:120000,direction:1}]},cookie:'local-owner-cookie'})).status,409);
  assert.equal(Number((await db.query('select count(*) n from public.validated_runs where game_session_id=$1',[impossibleId])).rows[0].n),0);

  const positiveInputs=[
    {sequence:0,atMs:250,direction:-1},{sequence:1,atMs:950,direction:-1},{sequence:2,atMs:1650,direction:1},
    {sequence:3,atMs:1900,direction:-1},{sequence:4,atMs:2230,direction:1},{sequence:5,atMs:2780,direction:1},{sequence:6,atMs:3110,direction:-1},
  ];
  const positiveSessionIds=[];
  const positiveHorizons=[];
  const positivePayloads=[];
  for(const seed of [1,2,3]) {
    const sessionId=randomUUID(); positiveSessionIds.push(sessionId);
    const inserted=(await db.query(`insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at)
      values($1,$2,$3,'rtw-v7',$4,now()+interval '3 seconds',now()+interval '10 minutes',1000,now()+interval '6 minutes') returning started_at`,[sessionId,owner,gameId,seed])).rows[0];
    const progress=replayAuthoritativeProgress('rtw-v7',seed,positiveInputs,120000);
    const baseline=replayAuthoritativeProgress('rtw-v7',seed,[],progress.elapsedMs);
    assert.ok(progress?.state==='crashed');
    assert.equal(load('lib/game/race-to-win/authoritative-replay.ts').hasMeaningfulReferralEvidence(progress,baseline),true);
    positiveHorizons.push(Date.parse(inserted.started_at)+progress.elapsedMs);
    positivePayloads.push({sessionId,inputs:positiveInputs});
  }
  const positiveWait=Math.max(...positiveHorizons)-Date.now()+1500;
  if(positiveWait>0) await new Promise(resolveWait=>setTimeout(resolveWait,positiveWait));
  for(const positive of positivePayloads) {
    const finalized=await httpRequest(finalizePath,{body:positive,cookie:'local-owner-cookie'});
    assert.equal(finalized.status,200,await finalized.text());
  }
  const eligiblePositiveRuns=(await db.query('select eligibility_status,referral_eligible from public.validated_runs where game_session_id=any($1::uuid[])',[positiveSessionIds])).rows;
  assert.equal(eligiblePositiveRuns.length,3);
  assert.ok(eligiblePositiveRuns.every(row=>row.eligibility_status==='valid' && row.referral_eligible));
  referralState=(await db.query('select qualified_day_count,status from public.referrals where id=$1',[referralId])).rows[0];
  assert.equal(referralState.qualified_day_count,1);
  assert.equal(referralState.status,'invite_pending');
  const checkpointId=randomUUID();
  await db.query(`insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at)
    select $1,$2,id,'rtw-v7',2,now()-interval '1 minute',now()+interval '5 minutes',1000,now()+interval '1 minute' from public.games where slug='race-to-win'`,[checkpointId,owner]);
  const checkpointBefore=Date.parse((await db.query('select activity_lease_expires_at from public.game_sessions where id=$1',[checkpointId])).rows[0].activity_lease_expires_at);
  const fakeCheckpoint=await httpRequest('/api/game-sessions/checkpoint',{body:{sessionId:checkpointId,checkpointIndex:1,inputs:[]},cookie:'local-owner-cookie'});
  assert.equal(fakeCheckpoint.status,409);
  assert.equal(Number((await db.query('select count(*) n from private.game_session_checkpoints where game_session_id=$1',[checkpointId])).rows[0].n),0);
  assert.equal(Date.parse((await db.query('select activity_lease_expires_at from public.game_sessions where id=$1',[checkpointId])).rows[0].activity_lease_expires_at),checkpointBefore);
  const expiredId=randomUUID();
  await db.query(`insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at)
    select $1,$2,id,'rtw-v7',3,now()-interval '20 minutes',now()-interval '10 minutes',1000,now()-interval '1 minute' from public.games where slug='race-to-win'`,[expiredId,owner]);
  const expired=await httpRequest(finalizePath,{body:{sessionId:expiredId,inputs:[]},cookie:'local-owner-cookie'});
  assert.equal(expired.status,409);
  assert.equal(Number((await db.query('select count(*) n from public.validated_runs where game_session_id=$1',[expiredId])).rows[0].n),0);
  assert.equal((await db.query('select status from public.game_sessions where id=$1',[expiredId])).rows[0].status,'active');
  const startRateRows=(await db.query('select request_count from private.competition_action_rate_limits where player_id=$1 and action=\'session_start\'',[owner])).rows;
  assert.equal(startRateRows.length,0);
  const burst=await Promise.all(Array.from({length:9},()=>httpRequest('/api/game-sessions/start',{cookie:'local-rate-cookie'})));
  assert.deepEqual(burst.map(response=>response.status).sort(),[200,200,200,200,200,200,200,200,429]);
  const burstCount=Number((await db.query('select count(*) n from public.game_sessions where user_id=$1 and created_at>now()-interval \'1 minute\'',[ratePlayer])).rows[0].n);
  assert.equal(burstCount,8);
  const concurrentId=randomUUID();
  await db.query(`insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at)
    select $1,$2,id,'rtw-v7',1,now()-interval '20 minutes',now()-interval '10 minutes',1000,now()+interval '1 minute' from public.games where slug='race-to-win'`,[concurrentId,owner]);
  const concurrent=await Promise.all(Array.from({length:8},()=>httpRequest(finalizePath,{body:{sessionId:concurrentId,inputs:[]},cookie:'local-owner-cookie'})));
  assert.deepEqual(concurrent.map(response=>response.status),Array(8).fill(200));
  const canonical=await concurrent[0].json();
  for(const response of concurrent.slice(1)) assert.deepEqual(await response.json(),canonical);
  assert.equal(Number((await db.query('select count(*) n from public.validated_runs where game_session_id=$1',[concurrentId])).rows[0].n),1);
  assert.equal((await httpRequest(finalizePath,{body:{sessionId:concurrentId,inputs:[{sequence:0,atMs:100,direction:1}]},cookie:'local-owner-cookie'})).status,409);
  const conflictId=randomUUID();
  await db.query(`insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at)
    select $1,$2,id,'rtw-v7',1,now()-interval '5 minutes',now()+interval '5 minutes',1000,now()+interval '1 minute' from public.games where slug='race-to-win'`,[conflictId,owner]);
  const conflicting=await Promise.all([
    httpRequest(finalizePath,{body:{sessionId:conflictId,inputs:[]},cookie:'local-owner-cookie'}),
    httpRequest(finalizePath,{body:{sessionId:conflictId,inputs:[{sequence:0,atMs:100,direction:1}]},cookie:'local-owner-cookie'}),
  ]);
  assert.deepEqual(conflicting.map(response=>response.status).sort(),[200,409]);
  assert.equal(Number((await db.query('select count(*) n from public.validated_runs where game_session_id=$1',[conflictId])).rows[0].n),1);
  const statusCounts=offensiveHttpStatuses.reduce((counts,status)=>({...counts,[status]:(counts[status]??0)+1}),{});
  console.log(`PASS ${offensiveHttpRequests} offensive loopback HTTP requests (HTTP status counts ${JSON.stringify(statusCounts)}): leaderboard bounds, anonymous/invalid-cookie/foreign/fake-metric/fake-input, checkpoint fabrication, expired lease, duplicate/conflicting FINALIZE, start burst and nonexistent prize/balance claims checked against PGlite state`);
  console.log(`PASS referral gate: three zero-input runs -> qualified_day_count=0; three scripted replay-positive controls -> qualified_day_count=${referralState.qualified_day_count} (status=${referralState.status}); finance remains empty`);
  return `PASS ${offensiveHttpRequests} offensive HTTP requests through real loopback handlers + PGlite; original referral attack blocked and positive referral flow retained`;
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
  }
}
