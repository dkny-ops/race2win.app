begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $test$
declare
 v_users uuid[]; v_actor uuid; v_session uuid; v_game uuid; v_player uuid;
 v_row uuid; v_i integer; v_allow integer:=0; v_rejected boolean;
 v_first jsonb; v_second jsonb; v_board jsonb;
 v_digest text:='4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';
 v_day date:='2026-10-12'; v_start timestamptz:='2026-10-12 12:00:00 America/New_York';
begin
 begin
  select a.user_id into v_actor from private.admin_users a join auth.users u on u.id=a.user_id
   where a.is_active and lower(u.email)='racetowinapp@gmail.com' and u.email_confirmed_at is not null limit 1;
  select array_agg(x.id) into v_users from (select u.id from auth.users u join public.profiles p on p.user_id=u.id where u.email_confirmed_at is not null and p.username is not null order by u.id limit 3) x;
  if v_actor is null or cardinality(v_users)<>3 then raise exception 'Need existing verified identities; no users fabricated'; end if;
  if (select enabled from private.flappy_control) then raise exception 'Test requires competition closed'; end if;
  select id into v_game from public.games where slug='flappy-race' and status='paused';
  if v_game is null then raise exception 'Paused Flappy catalogue required'; end if;
  -- Uncommitted test-only changes; all other connections continue to see CLOSED.
  update private.flappy_control set enabled=true;
  update public.games set status='active' where id=v_game;
  v_first:=public.flappy_start(v_users[1],42,'flappy-v1');
  v_session:=(v_first->>'sessionId')::uuid;
  if public.flappy_read_session(v_users[2],v_session) is not null then raise exception 'Foreign owner read'; end if;
  v_rejected:=false;
  begin perform public.flappy_start(v_users[1],42,'flappy-v1'); exception when sqlstate 'P0001' then v_rejected:=true; end;
  if not v_rejected then raise exception 'Concurrent-active guard failed'; end if;
  perform pg_sleep(3.8);
  perform public.flappy_record_evidence(v_users[1],v_session,'checkpoint',0,'{}',10,v_digest,0);
  v_rejected:=false;
  begin perform public.flappy_record_evidence(v_users[1],v_session,'checkpoint',10,ARRAY[4],11,v_digest,0); exception when sqlstate 'P0001' then v_rejected:=true; end;
  if not v_rejected then raise exception 'Input prefix rewrite allowed'; end if;
  v_first:=public.flappy_record_evidence(v_users[1],v_session,'finalize',10,'{}',39,v_digest,0);
  v_second:=public.flappy_record_evidence(v_users[1],v_session,'finalize',39,'{}',39,v_digest,0);
  if v_first<>v_second or (select count(*) from private.flappy_runs where session_id=v_session)<>1 then raise exception 'Finalization idempotence failed'; end if;
  if v_first->>'eligibility'<>'under_review' then raise exception 'Run auto-approved'; end if;
  v_rejected:=false;
  begin perform public.flappy_review_run(gen_random_uuid(),v_session,'valid','not authorized'); exception when sqlstate 'P0001' then v_rejected:=true; end;
  if not v_rejected then raise exception 'Unauthorized review'; end if;
  perform public.flappy_review_run(v_actor,v_session,'valid','Uncommitted reviewed fixture');
  perform public.flappy_review_run(v_actor,v_session,'valid','Uncommitted reviewed fixture');
  if (select count(*) from private.flappy_review_events where session_id=v_session)<>1 then raise exception 'Review duplicated'; end if;
  v_rejected:=false;
  begin perform public.flappy_review_run(v_actor,v_session,'disqualified','Conflicting retry'); exception when sqlstate 'P0001' then v_rejected:=true; end;
  if not v_rejected then raise exception 'Conflicting review accepted'; end if;
  v_rejected:=false;
  begin perform public.flappy_close_week(v_actor,date_trunc('week',clock_timestamp() at time zone 'America/New_York')::date); exception when sqlstate 'P0001' then v_rejected:=true; end;
  if not v_rejected then raise exception 'Current week closed early'; end if;
  for v_i in 1..40 loop if public.flappy_consume_quota(v_users[3],'checkpoint') then v_allow:=v_allow+1; end if; end loop;
  if v_allow<>30 then raise exception 'Quota exceeded: %',v_allow; end if;
  -- Ranking-only fixtures; never committed or presented as replay-valid runs.
  for v_i in 1..8 loop
   foreach v_player in array v_users[1:2] loop
    insert into private.flappy_sessions(player_id,game_id,version,seed,status,starts_at,expires_at,lease_until,digest,tick,inputs,outcome)
    values(v_player,v_game,'flappy-v1',42,'finalized',v_start,v_start+interval '10 minutes',v_start,v_digest,39,'{}',jsonb_build_object('score',v_i,'verification','replay_verified')) returning id into v_row;
    insert into private.flappy_runs(session_id,player_id,game_id,score,collision_tick,completed_at,tournament_day,tournament_week_start,eligibility,review_actor,reviewed_at,review_note)
    values(v_row,v_player,v_game,v_i,39,v_start,v_day,v_day,'valid',v_actor,clock_timestamp(),'Uncommitted ranking fixture');
   end loop;
  end loop;
  insert into private.flappy_sessions(player_id,game_id,version,seed,status,starts_at,expires_at,lease_until,digest,tick,inputs,outcome)
  values(v_users[3],v_game,'flappy-v1',42,'finalized',v_start,v_start+interval '10 minutes',v_start,v_digest,39,'{}','{"score":35,"verification":"replay_verified"}') returning id into v_row;
  insert into private.flappy_runs(session_id,player_id,game_id,score,collision_tick,completed_at,tournament_day,tournament_week_start)
  values(v_row,v_users[3],v_game,35,39,v_start,v_day,v_day);
  v_rejected:=false;
  begin perform public.flappy_close_week(v_actor,v_day); exception when sqlstate 'P0001' then v_rejected:=true; end;
  if not v_rejected then raise exception 'Closed a pending-review week'; end if;
  perform public.flappy_review_run(v_actor,v_row,'disqualified','Uncommitted rejection fixture');
  if (select eligibility from private.flappy_runs where session_id=v_row)<>'disqualified' then raise exception 'Reject failed'; end if;
  -- Rejected run stays rejected; a separate privileged fixture tests vector ties.
  insert into private.flappy_sessions(player_id,game_id,version,seed,status,starts_at,expires_at,lease_until,digest,tick,inputs,outcome)
  values(v_users[3],v_game,'flappy-v1',42,'finalized',v_start,v_start+interval '10 minutes',v_start,v_digest,39,'{}','{"score":35,"verification":"replay_verified"}') returning id into v_row;
  insert into private.flappy_runs(session_id,player_id,game_id,score,collision_tick,completed_at,tournament_day,tournament_week_start,eligibility,review_actor,reviewed_at,review_note)
  values(v_row,v_users[3],v_game,35,39,v_start,v_day,v_day,'valid',v_actor,clock_timestamp(),'Uncommitted vector fixture');
  v_board:=public.flappy_read_ranking(v_day,1);
  if jsonb_array_length(v_board->'entries')<>3 or (v_board#>>'{entries,0,weeklyTotal}')::integer<>35 or (v_board#>>'{entries,0,rank}')::integer<>1
   or v_board#>>'{entries,1,rank}' is not null or v_board#>>'{entries,2,rank}' is not null then raise exception 'Top-seven/vector/tie ranking incorrect: %',v_board; end if;
  v_first:=public.flappy_close_week(v_actor,v_day);v_second:=public.flappy_close_week(v_actor,v_day);
  if v_first<>v_second or (select count(*) from private.flappy_week_results where week=v_day)<>3 then raise exception 'Closure duplicated'; end if;
  if public.flappy_read_ranking(v_day,1)<>v_board then raise exception 'Snapshot differs'; end if;
  if public.flappy_read_week(v_day)->>'state'<>'closed' or public.flappy_read_week(v_day)->>'exactTiesPending'<>'true' then raise exception 'Closure status/ties lost'; end if;
  if extract(epoch from ((timestamp '2026-11-02' at time zone 'America/New_York')-(timestamp '2026-10-26' at time zone 'America/New_York')))/3600<>169 then raise exception 'DST week incorrect'; end if;
  raise sqlstate 'Z0001' using message='Rollback all fixtures after successful assertions';
 exception when sqlstate 'Z0001' then null;
 end;
end $test$;
-- Actual browser roles must fail to execute privileged functions or read tables.
set local role anon;
do $roles$ declare denied boolean:=false; begin
 begin perform public.flappy_read_week('2026-10-12'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'anon EXECUTE exposed'; end if;
end $roles$;
reset role;
set local role authenticated;
do $roles$ declare denied boolean:=false; begin
 begin perform 1 from private.flappy_week_results; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'authenticated table access exposed'; end if;
end $roles$;
reset role;
select jsonb_build_object('status','PASS','retained_test_runs',(select count(*) from private.flappy_runs),
'enabled',(select enabled from private.flappy_control),'game_status',(select status from public.games where slug='flappy-race'),
'review_events',(select count(*) from private.flappy_review_events),'closures',(select count(*) from private.flappy_week_closures),
'rtw_function_digest',(select md5(string_agg(pg_get_functiondef(p.oid),'|' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' and p.proname not like 'flappy_%')) as verification;
rollback;