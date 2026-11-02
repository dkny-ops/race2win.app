create table if not exists public.rtw_hourly_limit_test_exemptions (
 player_id uuid primary key references auth.users(id) on delete cascade,
 reason text not null,
 created_at timestamptz not null default now()
);
alter table public.rtw_hourly_limit_test_exemptions enable row level security;
revoke all on public.rtw_hourly_limit_test_exemptions from public,anon,authenticated;
insert into public.rtw_hourly_limit_test_exemptions(player_id,reason) values
('89565250-aafb-4508-a945-39cb329a5650','BadBoy internal gameplay test account'),
('9a216afd-7447-41d2-a7d0-e701cd579d14','test1 internal gameplay test account')
on conflict(player_id) do update set reason=excluded.reason;
create or replace function public.rtw_start_official_game_session_v3(p_player_id uuid, p_game_slug text, p_gameplay_version text, p_seed bigint)
returns table(id uuid, gameplay_version text, seed bigint, started_at timestamptz, expires_at timestamptz, checkpoint_interval_score integer, activity_lease_expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
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
 if p_player_id is null or p_gameplay_version not in ('rtw-v7','rtw-v8','rtw-v9') then
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
end $$;
create or replace function public.rtw_read_hourly_opportunities(p_player_id uuid, p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_hour timestamp; v_start timestamptz; v_end timestamptz; v_used integer; v_exempt boolean;
begin
 if p_player_id is null or p_game_id is null then raise exception 'Invalid request'; end if;
 select exists(select 1 from public.rtw_hourly_limit_test_exemptions e where e.player_id=p_player_id) into v_exempt;
 v_hour := date_trunc('hour', timezone('America/New_York', now()));
 v_start := v_hour at time zone 'America/New_York';
 v_end := (v_hour + interval '1 hour') at time zone 'America/New_York';
 select count(*) into v_used from public.game_sessions
 where user_id=p_player_id and game_id=p_game_id and created_at>=v_start and created_at<v_end;
 return jsonb_build_object('used',v_used,'reset_at',v_end,'exempt',v_exempt);
end $$;
revoke all on function public.rtw_read_hourly_opportunities(uuid,uuid) from public,anon,authenticated;
grant execute on function public.rtw_read_hourly_opportunities(uuid,uuid) to service_role;;

