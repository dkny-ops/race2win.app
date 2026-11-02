// Real local PostgreSQL only. Build the baseline with production-provenance/verify.cjs,
// then start it with listen_addresses='' and a private filesystem socket directory.
import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {existsSync,statSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const socket=process.env.LOCAL_PG_SOCKET_DIR;
if(!socket||!path.isAbsolute(socket)||!existsSync(socket)||!statSync(socket).isDirectory())
 throw Error('LOCAL_PG_SOCKET_DIR must name a local PostgreSQL filesystem socket directory; TCP/remote hosts are not accepted');
const bin=process.env.PSQL_BIN||'psql',port='55439';
const env={...process.env};for(const key of ['PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])delete env[key];
const base=['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',socket,'-p',port,'-U','postgres'];
const database='flappy_prize_fix_'+Date.now();
const sql=(query,db=database)=>execFileSync(bin,[...base,'-d',db,'-c',query],{env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:8e6}).trim();
const file=relative=>execFileSync(bin,[...base,'-d',database,'-1','-f',path.join(root,relative)],{env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:8e6});
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const actor='00000000-0000-4000-8000-000000000001';
const players=Array.from({length:4},()=>randomUUID()),legacy=randomUUID(),inactive=randomUUID(),racePlayer=randomUUID();
const sig='public.flappy_admin_allocate_prize(uuid,date,uuid,text)';
const migration='supabase/pending-migrations/20261102004207_fix_flappy_prize_allocation_transition.sql';
const cases=[];
const pass=name=>{cases.push(name);console.log('PASS '+name);};
const rejected=(operation,code)=>assert.throws(operation,error=>!code||String(error.stderr).includes(code));
const functions=()=>JSON.parse(sql(`select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'hash',md5(regexp_replace(pg_get_functiondef(p.oid),'[[:space:]]+',' ','g')),'acl',p.proacl::text) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' and (n.nspname='private' or p.proname like 'rtw_%' or p.proname like 'flappy_%')`));
const snapshot=player=>JSON.parse(sql(`select jsonb_build_object(${['prize_balances','prize_ledger_entries','provisional_winners','payouts','payout_credit_allocations'].map(table=>{
 const where=!player?'':table==='payout_credit_allocations'?`where t.payout_id in(select id from public.payouts where player_id=${literal(player)})`:`where player_id=${literal(player)}`;
 return `${literal(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t ${where})`;
}).join(',')})`));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
assert.equal(sql("select current_setting('listen_addresses')",'template1'),'','The test server must have TCP listening disabled');
sql('create database '+database+' template postgres','template1');
try {
 const manifest=JSON.parse(readFileSync(path.join(root,'supabase/verification/production-provenance/manifest.json'),'utf8'));
 const canonicalFunctions=rows=>rows.map(f=>({...f,acl:f.acl??''})).sort((a,b)=>a.signature<b.signature?-1:a.signature>b.signature?1:0);
 assert.deepEqual(canonicalFunctions(functions()),canonicalFunctions(manifest.functions),'baseline function code and grants must match captured production');
 const structureQuery=readFileSync(path.join(root,'supabase/verification/production-provenance/structure-fingerprints.sql'),'utf8');
 // The disposable clone has a new database name. Normalize only that physical
 // information_schema field; application definitions, privileges and RLS stay exact.
 const normalizedStructureQuery=structureQuery.replace(/md5\(\(snapshot->'(\w+)'\)::text\)/g,(_,key)=>{
  let text=`(snapshot->'${key}')::text`;
  for(const field of ['table_catalog','udt_catalog','domain_catalog','scope_catalog'])
   text=`replace(${text}, '"${field}": "' || current_database() || '"', '"${field}": "postgres"')`;
  return `md5(${text})`;
 });
 assert.deepEqual(JSON.parse(sql(normalizedStructureQuery)),manifest.structuralFingerprints);
 const week=sql("select date_trunc('week',current_date)::date-7");
 const call=(player,note='Synthetic allocation',who=actor)=>`select public.flappy_admin_allocate_prize('${who}','${week}','${player}',${literal(note)})`;
 const allocate=(player,note,who)=>JSON.parse(sql('set role service_role; '+call(player,note,who)));
 sql(`
  insert into auth.users(id,email_confirmed_at) values ${[...players,legacy,inactive,racePlayer].map(id=>`('${id}',now())`).join(',')};
  insert into public.profiles(user_id,username) select id,'fix'||substr(replace(id::text,'-',''),1,12) from auth.users where id in (${[...players,legacy,inactive,racePlayer].map(literal).join(',')});
  insert into private.admin_users(user_id,is_active) values('${inactive}',false);
  update private.flappy_prize_program set enabled=true,activated_at=now()-interval '90 days',inaugural_week_start='${week}'::date-56 where singleton;
  insert into private.flappy_prize_period_results(week,player_id,username,weekly_total,scores,rank_position,review_required)
  values ${players.map((id,i)=>`('${week}','${id}','Synthetic${i}',${1000-i},array[${1000-i}],${i+1},false)`).join(',')};
  select private.flappy_open_prize_cases('${week}');
  select public.flappy_decide_prize_candidate('${actor}','${week}','${players[0]}','approved','Synthetic human review');
  select public.flappy_decide_prize_candidate('${actor}','${week}','${players[1]}','approved','Synthetic human review');
 `);
 // Real historical financial rows, entirely synthetic and local. Seed them through
 // the existing review/credit and explicit owner-confirmation functions, not by
 // disabling triggers or weakening grants. No external payment provider is used.
 sql(`do $seed$
 declare i integer; winner uuid; first_winner uuid; game uuid; w date;
 begin
  select id into strict game from public.games where slug='flappy-race';
  for i in 1..5 loop
   w:='${week}'::date-i*7;
   insert into private.flappy_prize_period_results(week,player_id,username,weekly_total,scores,rank_position,review_required)
   values(w,'${legacy}','SyntheticLegacy',100,array[100],1,false);
   perform private.flappy_open_prize_cases(w);
   perform public.flappy_decide_prize_candidate('${actor}',w,'${legacy}','approved','Synthetic historical review');
   insert into public.provisional_winners(game_id,player_id,tournament_week_start,award_type,rank_position,amount_cents,allocation_status,status,claim_deadline_at)
   values(game,'${legacy}',w,'weekly_tournament',1,500,'allocated','provisional',now()+interval '90 days') returning id into winner;
   perform public.rtw_admin_transition_winner('${actor}',winner,'under_review','Synthetic review');
   perform public.rtw_admin_transition_winner('${actor}',winner,'verified','Synthetic review');
   perform public.rtw_admin_transition_winner('${actor}',winner,'approved_for_payment','Synthetic credit');
   if i=1 then first_winner:=winner; end if;
   if i=4 then
    perform public.rtw_owner_confirm_full_balance_paid('${actor}','${legacy}',first_winner);
    update private.admin_users set can_authorize_final_payment=true where user_id='${actor}';
    perform set_config('app.rtw_owner_final_payment','${actor}',true);
    perform public.rtw_admin_transition_winner('${actor}',first_winner,'paid','Synthetic historical payment');
   end if;
  end loop;
 end $seed$;`);
 const historical=snapshot(legacy);
 assert.equal(historical.prize_balances[0].available_cents,500);
 assert.equal(historical.payouts[0].status,'paid');
 const before=snapshot();
 rejected(()=>allocate(players[0]),'23514');
 assert.deepEqual(snapshot(),before);
 pass('baseline reproduces SQLSTATE 23514 with complete allocation rollback');
 const beforeFunctions=functions();
 const beforeStructure=sql(structureQuery);
 file(migration);file(migration);
 assert.deepEqual(snapshot(),before);
 assert.equal(sql(structureQuery),beforeStructure);
 const afterFunctions=functions();
 const changed=afterFunctions.filter(f=>JSON.stringify(f)!==JSON.stringify(beforeFunctions.find(b=>b.signature===f.signature)));
 assert.equal(afterFunctions.length,beforeFunctions.length);
 assert.equal(changed.length,1);assert.match(changed[0].signature,/^flappy_admin_allocate_prize\(/);
 assert.equal(changed[0].acl,beforeFunctions.find(f=>f.signature===changed[0].signature).acl);
 pass('migration is repeatable and changes only allocation code; all data, shared functions, RLS and grants unchanged');
 const first=allocate(players[0]);assert.equal(first.amountCents,500);assert.equal(first.paymentsEnabled,false);assert.equal(first.idempotent,false);
 const retry=allocate(players[0]);assert.equal(retry.winnerId,first.winnerId);assert.equal(retry.idempotent,true);
 assert.equal(sql(`select status from public.provisional_winners where id='${first.winnerId}'`),'approved_for_payment');
 assert.equal(sql(`select count(*) from public.prize_ledger_entries where player_id='${players[0]}' and entry_type='credit'`),'1');
 assert.equal(sql(`select available_cents from public.prize_balances where player_id='${players[0]}'`),'500');
 assert.equal(sql(`select count(*) from private.flappy_prize_winner_case_events where week='${week}' and player_id='${players[0]}' and decision='financial_credit_approved'`),'1');
 pass('fresh approved allocation creates one $5 credit, preserves audit and retries idempotently');
 rejected(()=>allocate(players[2]));rejected(()=>allocate(players[3]));
 rejected(()=>allocate(players[2],'Synthetic unauthorized actor',players[0]));
 rejected(()=>allocate(players[2],'Synthetic inactive actor',inactive));
 for(const role of ['anon','authenticated']){
  rejected(()=>sql(`set role ${role}; ${call(players[2])}`),'42501');
  rejected(()=>sql(`set role ${role}; insert into public.provisional_winners default values`),'42501');
  rejected(()=>sql(`set role ${role}; insert into public.prize_ledger_entries default values`),'42501');
  rejected(()=>sql(`set role ${role}; update public.prize_balances set available_cents=999999`),'42501');
 }
 pass('real browser roles cannot self-award or write financial tables; non-admin/inactive actors and unapproved/off-podium candidates denied');
 // Prove actual overlap: A holds the transaction advisory lock after allocation,
 // B is observed waiting on an advisory lock before A commits.
 const launch=(query,name)=>promisify(execFile)(bin,[...base,'-d',database,'-c',query],{env:{...env,PGAPPNAME:name},encoding:'utf8',windowsHide:true,maxBuffer:8e6});
 const aName=database+'_a',bName=database+'_b';
 const a=launch(`begin;set role service_role;${call(players[1])};select pg_sleep(3);commit;`,aName);
 let holder=false;
 for(let i=0;i<40;i++){if(sql(`select exists(select 1 from pg_stat_activity where application_name='${aName}' and wait_event='PgSleep')`)==='t'){holder=true;break;}await sleep(25);}
 assert.ok(holder,'first transaction must retain its allocation lock');
 const b=launch('set role service_role;'+call(players[1]),bName);
 let waited=false;
 for(let i=0;i<40;i++){if(sql(`select exists(select 1 from pg_stat_activity where application_name='${bName}' and wait_event_type='Lock' and wait_event='advisory')`)==='t'){waited=true;break;}await sleep(25);}
 const concurrent=await Promise.all([a,b]);assert.ok(waited,'second transaction must demonstrably overlap and wait');
 assert.match(concurrent[1].stdout,/"idempotent": true/);
 assert.equal(sql(`select count(*) from public.provisional_winners where game_id=(select id from public.games where slug='flappy-race') and player_id='${players[1]}'`),'1');
 assert.equal(sql(`select count(*) from public.prize_ledger_entries where player_id='${players[1]}'`),'1');
 assert.equal(sql(`select available_cents from public.prize_balances where player_id='${players[1]}'`),'300');
 assert.equal(sql(`select count(*) from private.flappy_prize_winner_case_events where player_id='${players[1]}' and decision='financial_credit_approved'`),'1');
 pass('independent concurrent transactions serialize: one $3 award, one credit, one audit event');
 sql(`select public.flappy_decide_prize_candidate('${actor}','${week}','${players[2]}','approved','Synthetic human review')`);
 assert.equal(allocate(players[2]).amountCents,200);
 pass('third-place fresh allocation remains $2');
 const paidWeek=sql(`select '${week}'::date-7`);
 rejected(()=>sql(`set role service_role;select public.flappy_admin_allocate_prize('${actor}','${paidWeek}','${legacy}','Do not alter historical payment')`));
 const winnerBefore=sql(`select to_jsonb(w) from public.provisional_winners w where id='${first.winnerId}'`);
 rejected(()=>sql(`update public.provisional_winners set amount_cents=999 where id='${first.winnerId}'`),'23514');
 assert.equal(sql(`select to_jsonb(w) from public.provisional_winners w where id='${first.winnerId}'`),winnerBefore);
 assert.deepEqual(snapshot(legacy),historical);
 assert.equal(sql('select count(*) from public.payouts'),String(historical.payouts.length));
 rejected(()=>sql(`update public.prize_balances set available_cents=-1 where player_id='${players[0]}'`),'42501');
 assert.equal(sql(`select available_cents from public.prize_balances where player_id='${players[0]}'`),'500');
 assert.equal(sql('select count(*) from public.prize_balances where available_cents<0'),'0');
 pass('allocated awards immutable; historical paid winner, payout, ledger, available balance preserved; no automatic payouts or negative balances');
 // Existing shared Race lifecycle must still require a claim/review before verification.
 const race=sql("select id from public.games where slug='race-to-win'");
 const raceWinner=sql(`insert into public.provisional_winners(game_id,player_id,tournament_week_start,award_type,rank_position,amount_cents,allocation_status,status,claim_deadline_at) values('${race}','${racePlayer}','${week}','weekly_tournament',1,500,'allocated','provisional',now()+interval '90 days') returning id`);
 rejected(()=>sql(`select public.rtw_admin_transition_winner('${actor}','${raceWinner}','verified','Invalid shortcut')`),'23514');
 for(const state of ['claim_started','verified','approved_for_payment'])sql(`set role service_role;select public.rtw_admin_transition_winner('${actor}','${raceWinner}','${state}','Synthetic Race review')`);
 assert.equal(sql(`select available_cents from public.prize_balances where player_id='${racePlayer}'`),'500');
 rejected(()=>sql(`set role service_role;select public.rtw_begin_balance_payout_request('${racePlayer}')`),'22023');
 pass('Race claim/review/credit and $20 minimum unchanged; global invalid shortcut still rejected');
 console.log(JSON.stringify({status:'PASS',checks:cases.length,cases,productionWrites:0,syntheticOnly:true}));
} finally {sql('drop database '+database+' with(force)','template1');}
