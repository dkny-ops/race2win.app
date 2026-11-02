alter table public.game_sessions drop constraint game_sessions_gameplay_version_check;
alter table public.game_sessions add constraint game_sessions_gameplay_version_check check (gameplay_version = any (array['rtw-v6','rtw-v7','rtw-v8','rtw-v9','rtw-v10','rtw-v11','rtw-v12','rtw-v13']));
alter table public.game_sessions drop constraint game_sessions_versioned_checkpoint_lease_shape;
alter table public.game_sessions add constraint game_sessions_versioned_checkpoint_lease_shape check ((gameplay_version = 'rtw-v6' and checkpoint_interval_score is null and activity_lease_expires_at is null) or (gameplay_version = any (array['rtw-v7','rtw-v8','rtw-v9','rtw-v10','rtw-v11','rtw-v12','rtw-v13']) and checkpoint_interval_score = 1000 and activity_lease_expires_at is not null));
CREATE OR REPLACE FUNCTION public.rtw_start_official_game_session_v3(p_player_id uuid, p_game_slug text, p_gameplay_version text, p_seed bigint)
 RETURNS TABLE(id uuid, gameplay_version text, seed bigint, started_at timestamp with time zone, expires_at timestamp with time zone, checkpoint_interval_score integer, activity_lease_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_game_id uuid;
 v_now timestamptz := now();
 v_started_at timestamptz := v_now + interval '3 seconds';
 v_lease_expires_at timestamptz := v_started_at + interval '6 minutes';
 v_starts_in_last_minute integer;
 v_hour_start timestamptz;
 v_hour_end timestamptz;
 v_hour_count integer;
 v_ny_hour timestamp;
 v_is_test_account boolean;
begin
 if p_player_id is null or p_gameplay_version not in ('rtw-v7','rtw-v8','rtw-v9','rtw-v10','rtw-v11','rtw-v12','rtw-v13') then
  raise exception 'Unsupported gameplay version.' using errcode='22023';
 end if;
 select game.id into v_game_id from public.games game
 where game.slug=p_game_slug and game.status='active' for key share;
 if not found then raise exception 'Game is unavailable.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('rtw:session-start:' || p_player_id::text,0));
 select exists(select 1 from public.rtw_hourly_limit_test_exemptions e where e.player_id=p_player_id) into v_is_test_account;
 select count(*) into v_starts_in_last_minute from public.game_sessions session
 where session.user_id=p_player_id and session.created_at>=v_now-interval '1 minute';
 if v_starts_in_last_minute>=8 then
  raise exception 'Official session start rate limit exceeded.' using errcode='P0001';
 end if;
 if not v_is_test_account then
  v_ny_hour := date_trunc('hour',timezone('America/New_York',v_now));
  v_hour_start := v_ny_hour at time zone 'America/New_York';
  v_hour_end := (v_ny_hour + interval '1 hour') at time zone 'America/New_York';
  select count(*) into v_hour_count from public.game_sessions session
  where session.user_id=p_player_id and session.game_id=v_game_id
  and session.created_at>=v_hour_start and session.created_at<v_hour_end;
  if v_hour_count>=5 then
   raise exception 'Hourly official opportunities exhausted.' using errcode='P0001';
  end if;
 end if;
 return query insert into public.game_sessions as session
 (id,user_id,game_id,gameplay_version,seed,started_at,expires_at,checkpoint_interval_score,activity_lease_expires_at)
 values (gen_random_uuid(),p_player_id,v_game_id,p_gameplay_version,p_seed,v_started_at,v_started_at+interval '10 minutes',1000,v_lease_expires_at)
 returning session.id,session.gameplay_version,session.seed,session.started_at,session.expires_at,session.checkpoint_interval_score,session.activity_lease_expires_at;
end $function$
;;
