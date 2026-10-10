-- Disposable local fixtures; no financial operations.
do $test$
declare
 a uuid := '11111111-1111-4111-8111-111111111111';
 b uuid := '22222222-2222-4222-8222-222222222222';
 g uuid; sid uuid; expired_id uuid; player uuid; i integer; n integer; lease timestamptz; retry_lease timestamptz; page jsonb;
begin
 select id into g from public.games where slug='race-to-win';
 insert into public.profiles(user_id,username) values(b,'FixtureOther');
 -- Existing v6 session remains usable after the upgrade.
 perform public.rtw_finalize_game_session_with_checkpoints('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',a,repeat('a',64),0,100,100000,1000,1000,'[]');
 begin
  perform public.rtw_finalize_game_session_with_checkpoints('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b,repeat('a',64),0,100,100000,1000,1000,'[]');
  raise exception 'foreign owner accepted';
 exception when no_data_found then null; end;
 begin
  perform public.rtw_finalize_game_session_with_checkpoints('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',a,repeat('a',64),0,100,100000,1000,1000,'[]');
  raise exception 'double finalize accepted';
 exception when check_violation then null; end;
 select id into sid from public.rtw_start_official_game_session_v3(b,'race-to-win','rtw-v7',42);
 if sid is null then raise exception 'START failed'; end if;
 sid:=gen_random_uuid();
 -- Existing ongoing synthetic session, past countdown and near lease renewal.
 insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at)
 values(sid,a,g,'rtw-v7',42,now()-interval '5 minutes',now()+interval '5 minutes',1000,now()+interval '1 minute');
 perform public.rtw_record_game_session_checkpoint_with_lease(sid,a,1,repeat('a',64),0);
 select activity_lease_expires_at into lease from public.game_sessions where id=sid;
 perform public.rtw_record_game_session_checkpoint_with_lease(sid,a,1,repeat('a',64),0);
 select activity_lease_expires_at into retry_lease from public.game_sessions where id=sid;
 if lease is distinct from retry_lease then raise exception 'retry renewed lease'; end if;
 begin
  perform public.rtw_finalize_game_session_with_checkpoints(sid,a,repeat('b',64),1,1000,100000,1000,1000,'[{"checkpointIndex":1,"inputCount":1,"inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]');
  raise exception 'conflicting proof accepted';
 exception when check_violation then null; end;
 perform public.rtw_finalize_game_session_with_checkpoints(sid,a,repeat('a',64),0,1000,100000,1000,1000,'[{"checkpointIndex":1,"inputCount":0,"inputDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]');
 if (select count(*) from public.validated_runs where game_session_id=sid)<>1 then raise exception 'duplicate validated run'; end if;
 expired_id := gen_random_uuid();
 insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at)
 values(expired_id,a,g,'rtw-v7',1,now()-interval '20 minutes',now()-interval '10 minutes',1000,now()-interval '1 minute');
 begin
  perform public.rtw_finalize_game_session_with_checkpoints(expired_id,a,repeat('a',64),0,0,0,0,0,'[]');
  raise exception 'expired finalize accepted';
 exception when check_violation then null; end;
 if (select status from public.game_sessions where id=expired_id)<>'active' then raise exception 'expired failure changed state'; end if;
 begin
  perform public.rtw_record_game_session_checkpoint_with_lease(expired_id,a,1,repeat('a',64),0);
  raise exception 'expired checkpoint accepted';
 exception when check_violation then null; end;
 -- Top7: scores 10..100 => top seven 40..100 => 490; next day 200 => 690.
 foreach player in array array[a,b] loop
 for i in 1..11 loop
  sid:=gen_random_uuid();
  insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at)
  values(sid,player,g,'rtw-v6',i,case when i=11 then '2026-09-29 16:00Z'::timestamptz else '2026-09-28 16:00Z'::timestamptz end,case when i=11 then '2026-09-29 16:10Z'::timestamptz else '2026-09-28 16:10Z'::timestamptz end);
  update public.game_sessions set status='finalized',finalized_at=started_at+interval '1 second',input_digest=repeat('a',64),input_count=0,final_score=case when i=11 then 200 else i*10 end,final_distance_millimeters=100000,final_elapsed_ms=1000,final_collision_at_ms=1000 where id=sid;
 end loop;
 end loop;
 select count(*) into n from public.daily_top_scores where game_id=g and player_id=a and tournament_day='2026-09-28';
 if n<>7 then raise exception 'Top7 count %',n; end if;
 if (select weekly_total_score from public.weekly_tournament_totals where game_id=g and player_id=a and tournament_week_start='2026-09-28')<>690 then raise exception 'weekly total'; end if;
 if (select cardinality(individual_scores) from public.weekly_tournament_totals where game_id=g and player_id=a and tournament_week_start='2026-09-28')<>11 then raise exception 'all-run tie vector'; end if;
 if (select count(*) from public.weekly_tournament_totals where game_id=g and tournament_week_start='2026-09-28' and tie_break_status='exact_tie')<>2 then raise exception 'exact tie status'; end if;
 if (select rank_position from public.weekly_tournament_totals where game_id=g and player_id=a and tournament_week_start='2026-09-28')<>1 then raise exception 'deterministic tie rank'; end if;
 page:=public.rtw_read_public_leaderboard_page_metadata(g,'2026-09-28',1,50);
 if jsonb_array_length(page->'entries')<>2 or page::text like '%player_id%' or page::text like '%email%' then raise exception 'public projection'; end if;
 page:=public.rtw_read_public_leaderboard_page_metadata(g,'2026-09-28',100,50);
 if jsonb_array_length(page->'entries')<>0 or (page->>'total_count')::integer<>2 then raise exception 'empty page metadata'; end if;
 begin
  perform public.rtw_read_public_leaderboard_page_metadata(g,'2026-09-29',1,50);
  raise exception 'invalid week accepted';
 exception when invalid_parameter_value then null; end;
 if private.ny_tournament_day('2026-11-02 04:30Z')<>'2026-11-01'::date or private.ny_tournament_week_start('2026-11-02 05:00Z')<>'2026-11-02'::date then raise exception 'DST/week boundary'; end if;
 if exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname like 'rtw_%' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))) then raise exception 'browser RPC privilege'; end if;
 if exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname in('private','public') and p.prosecdef and not ('search_path=""'=any(p.proconfig))) then raise exception 'definer path'; end if;
 if not public.rtw_consume_pre_auth_otp_rate_limit('otp_verify',repeat('a',64),repeat('b',64)) or not public.rtw_consume_pre_auth_otp_rate_limit('otp_verify',repeat('a',64),repeat('b',64)) or not public.rtw_consume_pre_auth_otp_rate_limit('otp_verify',repeat('a',64),repeat('b',64)) or public.rtw_consume_pre_auth_otp_rate_limit('otp_verify',repeat('a',64),repeat('b',64)) then raise exception 'OTP limit'; end if;
end $test$;
-- Owner, foreign owner and revoked session exercise real RLS.
insert into auth.sessions values('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111',null);
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","session_id":"44444444-4444-4444-8444-444444444444"}',false);
set role authenticated;
do $$ begin if (select count(*) from public.profiles)<>1 then raise exception 'owner profile denied'; end if; end $$;
reset role;
delete from auth.sessions;
set role authenticated;
do $$ begin if (select count(*) from public.profiles)<>0 then raise exception 'revoked profile visible'; end if; end $$;
reset role;
