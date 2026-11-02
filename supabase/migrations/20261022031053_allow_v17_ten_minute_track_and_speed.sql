alter table public.game_sessions drop constraint game_sessions_gameplay_version_check; alter table public.game_sessions add constraint game_sessions_gameplay_version_check check (gameplay_version = any (array['rtw-v6','rtw-v7','rtw-v8','rtw-v9','rtw-v10','rtw-v11','rtw-v12','rtw-v13','rtw-v14','rtw-v15','rtw-v16','rtw-v17'])); alter table public.game_sessions drop constraint game_sessions_versioned_checkpoint_lease_shape; alter table public.game_sessions add constraint game_sessions_versioned_checkpoint_lease_shape check ((gameplay_version = 'rtw-v6' and checkpoint_interval_score is null and activity_lease_expires_at is null) or (gameplay_version = any (array['rtw-v7','rtw-v8','rtw-v9','rtw-v10','rtw-v11','rtw-v12','rtw-v13','rtw-v14','rtw-v15','rtw-v16','rtw-v17']) and checkpoint_interval_score = 1000 and activity_lease_expires_at is not null));
CREATE OR REPLACE FUNCTION private.validate_game_session_checkpoint()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_session public.game_sessions%rowtype;
begin
  select * into v_session from public.game_sessions where id = new.game_session_id for update;
  if not found then raise exception 'Official session is unavailable.' using errcode = '23503'; end if;
  if v_session.gameplay_version = 'rtw-v6' then
    if v_session.status <> 'active' or v_session.expires_at <= now() then
      raise exception 'Official session is not active.' using errcode = '23514';
    end if;
    if new.player_id is distinct from v_session.user_id
      or new.gameplay_version is distinct from v_session.gameplay_version
      or new.milestone_score <> new.checkpoint_index * 5000 then
      raise exception 'Checkpoint does not match its official session.' using errcode = '23514';
    end if;
    return new;
  end if;
  if v_session.gameplay_version not in ('rtw-v7', 'rtw-v8', 'rtw-v9', 'rtw-v10', 'rtw-v11', 'rtw-v12', 'rtw-v13', 'rtw-v14', 'rtw-v15', 'rtw-v16', 'rtw-v17')
    or v_session.status <> 'active'
    or v_session.activity_lease_expires_at is null
    or v_session.activity_lease_expires_at <= now()
    or v_session.checkpoint_interval_score <> 1000
    or new.player_id is distinct from v_session.user_id
    or new.gameplay_version is distinct from v_session.gameplay_version
    or new.milestone_score <> new.checkpoint_index * v_session.checkpoint_interval_score then
    raise exception 'Checkpoint does not match its official session.' using errcode = '23514';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rtw_finalize_game_session_with_checkpoints(p_session_id uuid, p_player_id uuid, p_input_digest text, p_input_count integer, p_final_score integer, p_final_distance_millimeters bigint, p_final_elapsed_ms integer, p_final_collision_at_ms integer, p_referral_eligible boolean, p_antifraud_status text, p_antifraud_signals jsonb, p_checkpoint_proofs jsonb)
 RETURNS TABLE(status text, input_digest text, final_score integer, final_distance_millimeters bigint, final_elapsed_ms integer, final_collision_at_ms integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.game_sessions%rowtype;
  v_checkpoint private.game_session_checkpoints%rowtype;
  v_expected jsonb;
  v_required_count integer;
  v_index integer;
  v_checkpoint_interval integer;
  v_now timestamptz := now();
  v_signals text[];
begin
  if p_input_digest is null or p_input_digest !~ '^[a-f0-9]{64}$'
    or p_input_count is null or p_input_count not between 0 and 4096
    or p_final_score is null or p_final_score < 0 or p_final_distance_millimeters is null or p_final_distance_millimeters < 0
    or p_final_elapsed_ms is null or p_final_elapsed_ms < 0 or p_final_collision_at_ms is null
    or p_final_collision_at_ms < 0 or p_final_collision_at_ms > p_final_elapsed_ms
    or p_referral_eligible is null or p_antifraud_status not in ('verified', 'under_review')
    or p_antifraud_signals is null or jsonb_typeof(p_antifraud_signals) <> 'array'
    or p_checkpoint_proofs is null or jsonb_typeof(p_checkpoint_proofs) <> 'array' then
    raise exception 'Invalid server finalization evidence.' using errcode = '22023';
  end if;
  select coalesce(array_agg(value), '{}'::text[]) into v_signals
  from jsonb_array_elements_text(p_antifraud_signals) as signal(value);
  if cardinality(v_signals) > 3 or v_signals is not null and not (v_signals <@ array['uniform_input_cadence', 'webdriver_reported', 'untrusted_input_events']::text[]) then
    raise exception 'Invalid server anti-fraud evidence.' using errcode = '22023';
  end if;
  if (p_antifraud_status = 'verified' and cardinality(v_signals) <> 0)
    or (p_antifraud_status = 'under_review' and cardinality(v_signals) < 2) then
    raise exception 'Invalid server anti-fraud disposition.' using errcode = '22023';
  end if;

  select * into v_session from public.game_sessions where id = p_session_id and user_id = p_player_id for update;
  if not found then raise exception 'Official session is unavailable.' using errcode = 'P0002'; end if;
  if v_session.status <> 'active' then raise exception 'Official session is not active.' using errcode = '23514'; end if;
  if v_session.gameplay_version = 'rtw-v6' then
    if v_session.expires_at <= v_now then raise exception 'Official session is not active.' using errcode = '23514'; end if;
    v_checkpoint_interval := 5000;
  elsif v_session.gameplay_version in ('rtw-v7', 'rtw-v8', 'rtw-v9', 'rtw-v10', 'rtw-v11', 'rtw-v12', 'rtw-v13', 'rtw-v14', 'rtw-v15', 'rtw-v16', 'rtw-v17') and v_session.checkpoint_interval_score = 1000 and v_session.activity_lease_expires_at is not null then
    v_checkpoint_interval := 1000;
  else raise exception 'Official session has an invalid lifecycle.' using errcode = '23514'; end if;
  if v_session.gameplay_version in ('rtw-v7', 'rtw-v8', 'rtw-v9', 'rtw-v10', 'rtw-v11', 'rtw-v12', 'rtw-v13', 'rtw-v14', 'rtw-v15', 'rtw-v16', 'rtw-v17') and v_session.activity_lease_expires_at <= v_now then
    update public.game_sessions as session set status = 'expired', invalidated_at = v_now, invalidation_reason = 'activity_lease_expired'
      where session.id = v_session.id and session.status = 'active';
    raise exception 'Official session activity lease has expired.' using errcode = '23514';
  end if;
  v_required_count := floor(p_final_score / v_checkpoint_interval::numeric)::integer;
  for v_checkpoint in select * from private.game_session_checkpoints where game_session_id = p_session_id order by checkpoint_index loop
    if v_checkpoint.checkpoint_index > v_required_count then raise exception 'Checkpoint exceeds final authoritative score.' using errcode = '23514'; end if;
    select proof.value into v_expected from jsonb_array_elements(p_checkpoint_proofs) as proof(value)
      where (proof.value ->> 'checkpointIndex')::integer = v_checkpoint.checkpoint_index;
    if v_expected is null or (v_expected ->> 'inputCount')::integer <> v_checkpoint.proof_input_count
      or (v_expected ->> 'inputDigest') <> v_checkpoint.proof_input_digest then
      raise exception 'Checkpoint conflicts with final replay evidence.' using errcode = '23514';
    end if;
  end loop;
  for v_index in 1..v_required_count loop
    if not exists (select 1 from private.game_session_checkpoints where game_session_id = p_session_id and checkpoint_index = v_index) then
      insert into private.game_session_checkpoints (game_session_id, player_id, gameplay_version, checkpoint_index, milestone_score, proof_input_digest, proof_input_count)
      values (p_session_id, p_player_id, v_session.gameplay_version, v_index, v_index * v_checkpoint_interval, p_input_digest, p_input_count);
    end if;
  end loop;
  insert into private.game_session_antifraud_observations (game_session_id, player_id, assessment_status, signal_codes, input_count)
  values (p_session_id, p_player_id, p_antifraud_status, v_signals, p_input_count);
  return query update public.game_sessions as session
    set status = 'finalized', finalized_at = v_now, input_digest = p_input_digest, input_count = p_input_count,
        final_score = p_final_score, final_distance_millimeters = p_final_distance_millimeters,
        final_elapsed_ms = p_final_elapsed_ms, final_collision_at_ms = p_final_collision_at_ms,
        referral_eligible = p_referral_eligible, anti_fraud_status = p_antifraud_status
    where session.id = p_session_id and session.user_id = p_player_id and session.status = 'active'
    returning session.status, session.input_digest, session.final_score, session.final_distance_millimeters, session.final_elapsed_ms, session.final_collision_at_ms;
end;
$function$
;

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
  if v_session.gameplay_version not in ('rtw-v7', 'rtw-v8', 'rtw-v9', 'rtw-v10', 'rtw-v11', 'rtw-v12', 'rtw-v13', 'rtw-v14', 'rtw-v15', 'rtw-v16', 'rtw-v17')
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
 v_hour_start timestamptz;
 v_hour_end timestamptz;
 v_hour_count integer;
 v_ny_hour timestamp;
 v_is_test_account boolean;
begin
 if p_player_id is null or p_gameplay_version not in ('rtw-v7','rtw-v8','rtw-v9','rtw-v10','rtw-v11','rtw-v12','rtw-v13','rtw-v14', 'rtw-v15', 'rtw-v16', 'rtw-v17') then
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
 values (gen_random_uuid(),p_player_id,v_game_id,p_gameplay_version,p_seed,v_started_at,v_started_at+interval '15 minutes',1000,v_lease_expires_at)
 returning session.id,session.gameplay_version,session.seed,session.started_at,session.expires_at,session.checkpoint_interval_score,session.activity_lease_expires_at;
end $function$
;;
