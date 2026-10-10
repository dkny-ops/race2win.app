begin;
-- TEST only: execute with project_id=lndvnufmbuzdbinapvze. Always ROLLBACK.
do $test$
declare
  sid uuid := gen_random_uuid();
  owner_id uuid;
  game uuid;
  total bigint;
begin
  select user_id,game_id into owner_id,game from public.game_sessions where id='d3bfe233-9b2e-4965-945f-fe4cc1520327';
  if owner_id is null then raise exception 'TEST evidence session missing; stop'; end if;
  if not exists(select 1 from public.game_sessions where id='d3bfe233-9b2e-4965-945f-fe4cc1520327' and status='finalized' and final_elapsed_ms=608867 and final_score=7734) then raise exception 'Session evidence mismatch'; end if;
  if not exists(select 1 from public.validated_runs v join public.daily_top_scores d on d.validated_run_id=v.id where v.game_session_id='d3bfe233-9b2e-4965-945f-fe4cc1520327' and v.eligibility_status='valid' and d.daily_rank=1) then raise exception 'Validated Top7 mismatch'; end if;
  select sum(score) into total from public.daily_top_scores where player_id=owner_id and game_id=game and tournament_week_start='2026-10-05';
  if total<>25666 or not exists(select 1 from public.weekly_tournament_totals where player_id=owner_id and game_id=game and tournament_week_start='2026-10-05' and weekly_total_score=total) then raise exception 'Weekly sum mismatch'; end if;
  if exists(select 1 from public.daily_top_scores where player_id=owner_id and game_id=game group by tournament_day having count(*)>7) then raise exception 'Top7 overflow'; end if;
  if has_function_privilege('anon','public.rtw_finalize_game_session_with_checkpoints(uuid,uuid,text,integer,integer,bigint,integer,integer,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.rtw_finalize_game_session_with_checkpoints(uuid,uuid,text,integer,integer,bigint,integer,integer,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.rtw_finalize_game_session_with_checkpoints(uuid,uuid,text,integer,integer,bigint,integer,integer,jsonb)','EXECUTE') then raise exception 'FINALIZE privilege mismatch'; end if;
  if has_table_privilege('authenticated','public.game_sessions','UPDATE') or has_table_privilege('anon','public.game_sessions','INSERT') then raise exception 'Browser session authority'; end if;
  if not (select relrowsecurity from pg_class where oid='public.game_sessions'::regclass) then raise exception 'Session RLS disabled'; end if;
  insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at)
  values(sid,owner_id,game,'rtw-v7',1,now()-interval '11 minutes',now()-interval '1 minute',1000,now()-interval '1 second');
  begin
    perform * from public.rtw_finalize_game_session_with_checkpoints(sid,owner_id,repeat('a',64),0,0,0,0,0,'[]'::jsonb);
    raise exception 'Expired lease accepted';
  exception when check_violation then null;
  end;
  -- The RPC raises, so its status UPDATE is rolled back with the exception.
  if not exists(select 1 from public.game_sessions where id=sid and status='active') then raise exception 'Expired failure changed canonical state'; end if;
  begin
    perform * from public.rtw_finalize_game_session_with_checkpoints(sid,gen_random_uuid(),repeat('a',64),0,0,0,0,0,'[]'::jsonb);
    raise exception 'Wrong owner accepted';
  exception when no_data_found then null;
  end;
  begin
    perform * from public.rtw_finalize_game_session_with_checkpoints(sid,owner_id,null,0,0,0,0,0,'[]'::jsonb);
    raise exception 'Null digest accepted';
  exception when invalid_parameter_value then null;
  end;
  -- Checkpoint behavior uses an isolated fixture and never finalizes a run.
  sid := gen_random_uuid();
  insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at)
  values(sid,owner_id,game,'rtw-v7',1,now()-interval '11 minutes',now()-interval '1 minute',1000,now()+interval '1 minute');
  if not exists(select 1 from public.rtw_record_game_session_checkpoint_with_lease(sid,owner_id,1,repeat('a',64),0) where accepted and lease_renewed and milestone_score=1000) then raise exception 'Checkpoint not accepted'; end if;
  if not exists(select 1 from public.rtw_record_game_session_checkpoint_with_lease(sid,owner_id,1,repeat('a',64),0) where accepted and not lease_renewed and milestone_score=1000) then raise exception 'Retry renewed lease twice'; end if;
  if (select count(*) from private.game_session_checkpoints where game_session_id=sid)<>1 then raise exception 'Duplicate checkpoint'; end if;
  begin
    perform * from public.rtw_record_game_session_checkpoint_with_lease(sid,owner_id,1,repeat('b',64),0);
    raise exception 'Conflicting checkpoint accepted';
  exception when check_violation then null;
  end;
  begin
    perform * from public.rtw_record_game_session_checkpoint_with_lease(sid,gen_random_uuid(),1,repeat('a',64),0);
    raise exception 'Wrong checkpoint owner accepted';
  exception when no_data_found then null;
  end;
end;
$test$;
select 'PASS: expired FINALIZE 23514, ownership, malformed evidence, checkpoint retry/conflict, RLS, Top7 and weekly sum' result;
rollback;
