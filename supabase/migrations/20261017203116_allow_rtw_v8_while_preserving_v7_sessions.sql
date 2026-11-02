-- Permit rtw-v8 alongside in-flight rtw-v6/v7 sessions. No game client switch yet.
alter table public.game_sessions drop constraint game_sessions_gameplay_version_check;
alter table public.game_sessions add constraint game_sessions_gameplay_version_check check (gameplay_version in ('rtw-v6','rtw-v7','rtw-v8'));
alter table public.game_sessions drop constraint game_sessions_versioned_checkpoint_lease_shape;
alter table public.game_sessions add constraint game_sessions_versioned_checkpoint_lease_shape check ((gameplay_version='rtw-v6' and checkpoint_interval_score is null and activity_lease_expires_at is null) or (gameplay_version in ('rtw-v7','rtw-v8') and checkpoint_interval_score=1000 and activity_lease_expires_at is not null));
CREATE OR REPLACE FUNCTION public.rtw_record_game_session_checkpoint_with_lease(p_session_id uuid, p_player_id uuid, p_checkpoint_index integer, p_proof_input_digest text, p_proof_input_count integer)
 RETURNS TABLE(checkpoint_index integer, milestone_score integer, accepted boolean, lease_renewed boolean, activity_lease_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.game_sessions%rowtype;
  v_existing private.game_session_checkpoints%rowtype;
  v_expected_next integer;
  v_now timestamptz := now();
  v_new_lease timestamptz := v_now + interval '6 minutes';
begin
  if p_checkpoint_index not between 1 and 1000000
    or p_proof_input_digest !~ '^[a-f0-9]{64}$'
    or p_proof_input_count not between 0 and 4096 then
    raise exception 'Invalid checkpoint evidence.' using errcode = '22023';
  end if;

  select * into v_session
  from public.game_sessions
  where id = p_session_id and user_id = p_player_id
  for update;
  if not found then
    raise exception 'Official session is unavailable.' using errcode = 'P0002';
  end if;
  if v_session.gameplay_version not in ('rtw-v7','rtw-v8')
    or v_session.checkpoint_interval_score <> 1000
    or v_session.activity_lease_expires_at is null then
    raise exception 'Official session does not support renewable leases.' using errcode = '23514';
  end if;
  if v_session.status <> 'active' then
    raise exception 'Official session is not active.' using errcode = '23514';
  end if;
  if v_session.activity_lease_expires_at <= v_now then
    update public.game_sessions
    set status = 'expired', invalidated_at = v_now, invalidation_reason = 'activity_lease_expired'
    where id = v_session.id and status = 'active';
    raise exception 'Official session activity lease has expired.' using errcode = '23514';
  end if;

  select coalesce(max(checkpoint.checkpoint_index), 0) + 1 into v_expected_next
  from private.game_session_checkpoints as checkpoint
  where checkpoint.game_session_id = v_session.id;

  if p_checkpoint_index < v_expected_next then
    select * into v_existing
    from private.game_session_checkpoints as checkpoint
    where checkpoint.game_session_id = v_session.id
      and checkpoint.checkpoint_index = p_checkpoint_index;
    if v_existing.proof_input_digest <> p_proof_input_digest
      or v_existing.proof_input_count <> p_proof_input_count then
      raise exception 'Checkpoint conflicts with canonical evidence.' using errcode = '23514';
    end if;
    return query select v_existing.checkpoint_index, v_existing.milestone_score,
      true, false, v_session.activity_lease_expires_at;
    return;
  end if;

  insert into private.game_session_checkpoints (
    game_session_id, player_id, gameplay_version, checkpoint_index,
    milestone_score, proof_input_digest, proof_input_count
  )
  select v_session.id, v_session.user_id, v_session.gameplay_version, generated.checkpoint_index,
    generated.checkpoint_index * v_session.checkpoint_interval_score, p_proof_input_digest, p_proof_input_count
  from generate_series(v_expected_next, p_checkpoint_index) as generated(checkpoint_index);

  perform set_config('rtw.activity_lease_renewal', 'validated', true);
  update public.game_sessions
  set activity_lease_expires_at = v_new_lease
  where id = v_session.id and status = 'active';

  return query select p_checkpoint_index,
    p_checkpoint_index * v_session.checkpoint_interval_score,
    true, true, v_new_lease;
end;
$function$
;
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
begin
  if p_gameplay_version not in ('rtw-v7','rtw-v8') then
    raise exception 'Unsupported gameplay version.' using errcode = '22023';
  end if;

  select game.id into v_game_id
  from public.games as game
  where game.slug = p_game_slug and game.status = 'active'
  for key share;
  if not found then raise exception 'Game is unavailable.' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('rtw:session-start:' || p_player_id::text, 0));
  select count(*) into v_starts_in_last_minute
  from public.game_sessions as session
  where session.user_id = p_player_id
    and session.created_at >= v_now - interval '1 minute';
  if v_starts_in_last_minute >= 8 then
    raise exception 'Official session start rate limit exceeded.' using errcode = 'P0001';
  end if;

  return query
  insert into public.game_sessions as session (
    id, user_id, game_id, gameplay_version, seed, started_at, expires_at,
    checkpoint_interval_score, activity_lease_expires_at
  ) values (
    gen_random_uuid(), p_player_id, v_game_id, p_gameplay_version, p_seed,
    v_started_at, v_started_at + interval '10 minutes', 1000, v_lease_expires_at
  ) returning session.id, session.gameplay_version, session.seed, session.started_at,
    session.expires_at, session.checkpoint_interval_score, session.activity_lease_expires_at;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.rtw_start_official_game_session_v4(p_player_id uuid, p_game_slug text, p_gameplay_version text, p_seed bigint, p_start_request_id uuid)
 RETURNS TABLE(id uuid, gameplay_version text, seed bigint, started_at timestamp with time zone, expires_at timestamp with time zone, checkpoint_interval_score integer, activity_lease_expires_at timestamp with time zone, allowance_source text, free_plays_remaining integer, rewarded_plays_remaining integer, hour_started_at timestamp with time zone, hour_ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_game_id uuid; v_hour timestamptz := private.official_play_hour_start(now());
  v_request private.official_play_start_requests%rowtype; v_credit private.verified_rewarded_play_credits%rowtype;
  v_session record; v_used integer; v_source text; v_free_remaining integer; v_rewarded_remaining integer; v_existing_hour timestamptz;
begin
  if p_player_id is null or p_start_request_id is null or p_gameplay_version not in ('rtw-v7','rtw-v8') then
    raise exception 'Invalid official session start.' using errcode = '22023';
  end if;
  select game.id into v_game_id from public.games as game where game.slug = p_game_slug and game.status = 'active' for key share;
  if not found then raise exception 'Game is unavailable.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rtw:play-allowance:' || p_player_id::text || ':' || v_game_id::text || ':' || v_hour::text, 0));

  select request.* into v_request from private.official_play_start_requests as request
    where request.player_id = p_player_id and request.game_id = v_game_id and request.request_id = p_start_request_id for update;
  if found and v_request.game_session_id is not null then
    select session.id, session.gameplay_version, session.seed, session.started_at, session.expires_at, session.checkpoint_interval_score, session.activity_lease_expires_at
      into v_session from public.game_sessions session where session.id = v_request.game_session_id and session.user_id = p_player_id;
    if not found then raise exception 'Official session is unavailable.' using errcode = 'P0002'; end if;
    v_existing_hour := v_request.hour_started_at;
    select allowance.free_plays_consumed into v_used from private.official_play_allowance_windows as allowance where allowance.player_id=p_player_id and allowance.game_id=v_game_id and allowance.hour_started_at=v_existing_hour;
    select count(*) into v_rewarded_remaining from private.verified_rewarded_play_credits as credit where credit.player_id=p_player_id and credit.game_id=v_game_id and credit.hour_started_at=v_existing_hour and credit.status='issued';
    return query select v_session.id,v_session.gameplay_version,v_session.seed,v_session.started_at,v_session.expires_at,v_session.checkpoint_interval_score,v_session.activity_lease_expires_at,v_request.allowance_source,greatest(0,5-coalesce(v_used,0)),v_rewarded_remaining,v_existing_hour,v_existing_hour+interval '1 hour';
    return;
  end if;

  insert into private.official_play_start_requests(player_id,game_id,hour_started_at,request_id)
    values(p_player_id,v_game_id,v_hour,p_start_request_id) on conflict do nothing;
  insert into private.official_play_allowance_windows(player_id,game_id,hour_started_at)
    values(p_player_id,v_game_id,v_hour) on conflict do nothing;
  select allowance.free_plays_consumed into v_used from private.official_play_allowance_windows as allowance
    where allowance.player_id=p_player_id and allowance.game_id=v_game_id and allowance.hour_started_at=v_hour for update;
  if v_used < 5 then
    update private.official_play_allowance_windows set free_plays_consumed=free_plays_consumed+1,updated_at=now()
      where official_play_allowance_windows.player_id=p_player_id and official_play_allowance_windows.game_id=v_game_id and official_play_allowance_windows.hour_started_at=v_hour returning free_plays_consumed into v_used;
    v_source := 'free';
  else
    select * into v_credit from private.verified_rewarded_play_credits
      where verified_rewarded_play_credits.player_id=p_player_id and verified_rewarded_play_credits.game_id=v_game_id and verified_rewarded_play_credits.hour_started_at=v_hour and verified_rewarded_play_credits.status='issued'
      order by verified_rewarded_play_credits.issued_at,verified_rewarded_play_credits.id for update skip locked limit 1;
    if not found then raise exception 'No official plays remain for this New York hour.' using errcode = 'P0001'; end if;
    v_source := 'rewarded';
  end if;

  select * into v_session from public.rtw_start_official_game_session_v3(p_player_id,p_game_slug,p_gameplay_version,p_seed);
  update private.official_play_start_requests set game_session_id=v_session.id, allowance_source=v_source
    where official_play_start_requests.player_id=p_player_id and official_play_start_requests.game_id=v_game_id and official_play_start_requests.request_id=p_start_request_id;
  if v_source='rewarded' then update private.verified_rewarded_play_credits set status='consumed', consumed_at=now(), consumed_session_id=v_session.id where verified_rewarded_play_credits.id=v_credit.id; end if;
  select count(*) into v_rewarded_remaining from private.verified_rewarded_play_credits as credit where credit.player_id=p_player_id and credit.game_id=v_game_id and credit.hour_started_at=v_hour and credit.status='issued';
  return query select v_session.id,v_session.gameplay_version,v_session.seed,v_session.started_at,v_session.expires_at,v_session.checkpoint_interval_score,v_session.activity_lease_expires_at,v_source,greatest(0,5-v_used),v_rewarded_remaining,v_hour,v_hour+interval '1 hour';
end;
$function$
;
;
