-- rtw-v7 replaces the historical absolute ten-minute gameplay cutoff with a
-- renewable, server-controlled activity lease. `expires_at` remains immutable
-- legacy compatibility data for pre-v7 sessions; no v7 authorization path may
-- use it as an authoritative gameplay deadline.

alter table public.game_sessions
  add column if not exists checkpoint_interval_score integer,
  add column if not exists activity_lease_expires_at timestamptz;

update public.game_sessions
set checkpoint_interval_score = 5000,
    activity_lease_expires_at = expires_at
where checkpoint_interval_score is null
   or activity_lease_expires_at is null;

alter table public.game_sessions
  alter column checkpoint_interval_score set not null,
  alter column activity_lease_expires_at set not null;

alter table public.game_sessions
  drop constraint if exists game_sessions_checkpoint_interval_score_check,
  add constraint game_sessions_checkpoint_interval_score_check
    check (checkpoint_interval_score in (1000, 5000));

alter table public.game_sessions
  drop constraint if exists game_sessions_gameplay_version_check,
  add constraint game_sessions_gameplay_version_check
    check (gameplay_version in ('rtw-v6', 'rtw-v7'));

comment on column public.game_sessions.expires_at is
  'Legacy fixed expiry retained for historical rtw-v6 compatibility. rtw-v7 authorization uses activity_lease_expires_at only.';
comment on column public.game_sessions.activity_lease_expires_at is
  'Server-controlled renewable activity lease. It changes only inside a validated checkpoint function.';

-- Active sessions may only change their lease from the privileged validated
-- checkpoint function. Finalization and expiry may change status, but neither
-- can rewrite authoritative identity, inputs, scores, or lease history.
create or replace function private.protect_game_session_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.game_id is distinct from old.game_id
    or new.gameplay_version is distinct from old.gameplay_version
    or new.seed is distinct from old.seed
    or new.created_at is distinct from old.created_at
    or new.started_at is distinct from old.started_at
    or new.expires_at is distinct from old.expires_at
    or new.checkpoint_interval_score is distinct from old.checkpoint_interval_score then
    raise exception 'Immutable game session fields cannot be changed.' using errcode = '23514';
  end if;

  if old.status <> 'active' then
    raise exception 'A completed or invalid session is immutable.' using errcode = '23514';
  end if;

  if new.status = 'active' then
    if current_setting('rtw.activity_lease_renewal', true) <> 'validated'
      or new.activity_lease_expires_at <= old.activity_lease_expires_at
      or new.finalized_at is distinct from old.finalized_at
      or new.invalidated_at is distinct from old.invalidated_at
      or new.invalidation_reason is distinct from old.invalidation_reason
      or new.input_digest is distinct from old.input_digest
      or new.input_count is distinct from old.input_count
      or new.final_score is distinct from old.final_score
      or new.final_distance_millimeters is distinct from old.final_distance_millimeters
      or new.final_elapsed_ms is distinct from old.final_elapsed_ms
      or new.final_collision_at_ms is distinct from old.final_collision_at_ms then
      raise exception 'An active session lease can only be renewed by validated server evidence.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.activity_lease_expires_at is distinct from old.activity_lease_expires_at then
    raise exception 'Only an active session lease may be renewed.' using errcode = '23514';
  end if;

  if new.status = 'finalized' and new.finalized_at is null then
    raise exception 'A finalized session requires a server finalization time.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_game_session_integrity() from public, anon, authenticated;

-- New starts receive a six-minute activity lease. The maximum time required
-- to reach a 1,000-point checkpoint at the minimum authoritative velocity is
-- under five minutes, leaving a conservative 45-second network margin. Every
-- renewal is `now() + six minutes`, never an additive extension.
create function public.rtw_start_official_game_session_v3(
  p_player_id uuid,
  p_game_slug text,
  p_gameplay_version text,
  p_seed bigint
)
returns table (
  id uuid,
  gameplay_version text,
  seed bigint,
  started_at timestamptz,
  expires_at timestamptz,
  checkpoint_interval_score integer,
  activity_lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_now timestamptz := now();
  v_started_at timestamptz := v_now + interval '3 seconds';
  v_lease_expires_at timestamptz := v_started_at + interval '6 minutes';
  v_starts_in_last_minute integer;
begin
  if p_gameplay_version <> 'rtw-v7' then
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
$$;

revoke all on function public.rtw_start_official_game_session_v3(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.rtw_start_official_game_session_v3(uuid, text, text, bigint) to service_role;

-- Checkpoint rows retain historical v6 (5,000-point) evidence and accept v7
-- (1,000-point) evidence. The session itself is the source of the interval.
alter table private.game_session_checkpoints
  drop constraint if exists game_session_checkpoints_milestone_score_check,
  add constraint game_session_checkpoints_milestone_score_positive_check
    check (milestone_score > 0);

create or replace function private.validate_game_session_checkpoint()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  select * into v_session
  from public.game_sessions
  where id = new.game_session_id
  for update;

  if not found then
    raise exception 'Official session is unavailable.' using errcode = '23503';
  end if;
  if v_session.status <> 'active' or v_session.activity_lease_expires_at <= now() then
    raise exception 'Official session is not active.' using errcode = '23514';
  end if;
  if new.player_id is distinct from v_session.user_id
    or new.gameplay_version is distinct from v_session.gameplay_version
    or new.milestone_score <> new.checkpoint_index * v_session.checkpoint_interval_score then
    raise exception 'Checkpoint does not match its official session.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_game_session_checkpoint() from public, anon, authenticated;
revoke insert on table private.game_session_checkpoints from service_role;
grant select on table private.game_session_checkpoints to service_role;

-- This is the sole v7 lease-renewal path. It takes one row lock, checks the
-- unexpired lease while locked, stores contiguous checkpoint evidence, then
-- renews to a fixed server timestamp. A concurrent exact retry observes the
-- canonical row and cannot extend the lease a second time.
create function public.rtw_record_game_session_checkpoint_with_lease(
  p_session_id uuid,
  p_player_id uuid,
  p_checkpoint_index integer,
  p_proof_input_digest text,
  p_proof_input_count integer
)
returns table (
  checkpoint_index integer,
  milestone_score integer,
  accepted boolean,
  lease_renewed boolean,
  activity_lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
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
    from private.game_session_checkpoints
    where game_session_id = v_session.id and checkpoint_index = p_checkpoint_index;
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
  select v_session.id, v_session.user_id, v_session.gameplay_version, checkpoint_index,
    checkpoint_index * v_session.checkpoint_interval_score, p_proof_input_digest, p_proof_input_count
  from generate_series(v_expected_next, p_checkpoint_index) as checkpoint_index;

  perform set_config('rtw.activity_lease_renewal', 'validated', true);
  update public.game_sessions
  set activity_lease_expires_at = v_new_lease
  where id = v_session.id and status = 'active';

  return query select p_checkpoint_index,
    p_checkpoint_index * v_session.checkpoint_interval_score,
    true, true, v_new_lease;
end;
$$;

revoke all on function public.rtw_record_game_session_checkpoint_with_lease(uuid, uuid, integer, text, integer) from public, anon, authenticated;
grant execute on function public.rtw_record_game_session_checkpoint_with_lease(uuid, uuid, integer, text, integer) to service_role;

-- Finalization uses the renewable lease, never the legacy expires_at value.
-- Missing checkpoints are backfilled only from a replay result already
-- reconstructed by the server route; the function serializes that write with
-- finalization and rejects expired leases rather than reviving them.
create or replace function public.rtw_finalize_game_session_with_checkpoints(
  p_session_id uuid,
  p_player_id uuid,
  p_input_digest text,
  p_input_count integer,
  p_final_score integer,
  p_final_distance_millimeters bigint,
  p_final_elapsed_ms integer,
  p_final_collision_at_ms integer,
  p_checkpoint_proofs jsonb
)
returns table (status text, input_digest text, final_score integer, final_distance_millimeters bigint, final_elapsed_ms integer, final_collision_at_ms integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.game_sessions%rowtype;
  v_checkpoint private.game_session_checkpoints%rowtype;
  v_expected jsonb;
  v_required_count integer;
  v_index integer;
  v_now timestamptz := now();
begin
  if p_input_digest is null or p_input_digest !~ '^[a-f0-9]{64}$'
    or p_input_count is null or p_input_count not between 0 and 4096
    or p_final_score is null or p_final_score < 0
    or p_final_distance_millimeters is null or p_final_distance_millimeters < 0
    or p_final_elapsed_ms is null or p_final_elapsed_ms < 0
    or p_final_collision_at_ms is null or p_final_collision_at_ms < 0
    or p_final_collision_at_ms > p_final_elapsed_ms
    or p_checkpoint_proofs is null or jsonb_typeof(p_checkpoint_proofs) <> 'array' then
    raise exception 'Invalid server finalization evidence.' using errcode = '22023';
  end if;

  select * into v_session from public.game_sessions
  where id = p_session_id and user_id = p_player_id for update;
  if not found then raise exception 'Official session is unavailable.' using errcode = 'P0002'; end if;
  if v_session.status <> 'active' then raise exception 'Official session is not active.' using errcode = '23514'; end if;
  if v_session.activity_lease_expires_at <= v_now then
    update public.game_sessions
    set status = 'expired', invalidated_at = v_now, invalidation_reason = 'activity_lease_expired'
    where id = v_session.id and status = 'active';
    raise exception 'Official session activity lease has expired.' using errcode = '23514';
  end if;

  v_required_count := floor(p_final_score / v_session.checkpoint_interval_score::numeric)::integer;
  for v_checkpoint in select * from private.game_session_checkpoints where game_session_id = p_session_id order by checkpoint_index loop
    if v_checkpoint.checkpoint_index > v_required_count then
      raise exception 'Checkpoint exceeds final authoritative score.' using errcode = '23514';
    end if;
    select proof.value into v_expected from jsonb_array_elements(p_checkpoint_proofs) as proof(value)
    where (proof.value ->> 'checkpointIndex')::integer = v_checkpoint.checkpoint_index;
    if v_expected is null or (v_expected ->> 'inputCount')::integer <> v_checkpoint.proof_input_count
      or (v_expected ->> 'inputDigest') <> v_checkpoint.proof_input_digest then
      raise exception 'Checkpoint conflicts with final replay evidence.' using errcode = '23514';
    end if;
  end loop;

  for v_index in 1..v_required_count loop
    if not exists (select 1 from private.game_session_checkpoints where game_session_id = p_session_id and checkpoint_index = v_index) then
      insert into private.game_session_checkpoints (
        game_session_id, player_id, gameplay_version, checkpoint_index,
        milestone_score, proof_input_digest, proof_input_count
      ) values (
        p_session_id, p_player_id, v_session.gameplay_version, v_index,
        v_index * v_session.checkpoint_interval_score, p_input_digest, p_input_count
      );
    end if;
  end loop;

  return query update public.game_sessions as session
  set status = 'finalized', finalized_at = v_now, input_digest = p_input_digest,
      input_count = p_input_count, final_score = p_final_score,
      final_distance_millimeters = p_final_distance_millimeters,
      final_elapsed_ms = p_final_elapsed_ms, final_collision_at_ms = p_final_collision_at_ms
  where session.id = p_session_id and session.user_id = p_player_id and session.status = 'active'
  returning session.status, session.input_digest, session.final_score,
    session.final_distance_millimeters, session.final_elapsed_ms, session.final_collision_at_ms;
end;
$$;

revoke all on function public.rtw_finalize_game_session_with_checkpoints(uuid, uuid, text, integer, integer, bigint, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.rtw_finalize_game_session_with_checkpoints(uuid, uuid, text, integer, integer, bigint, integer, integer, jsonb) to service_role;

-- At most eight checkpoint actions per minute. rtw-v7 reaches at most one
-- ordinary milestone about every 75 seconds at top speed; this permits bounded
-- retries while absorbing abusive request storms.
create or replace function public.rtw_consume_competition_action_rate_limit(
  p_player_id uuid,
  p_action text
)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_window timestamptz := date_trunc('minute', now()); v_count integer;
begin
  case p_action
    when 'referral_attach' then v_limit := 6;
    when 'prize_claim' then v_limit := 6;
    when 'balance_claim' then v_limit := 4;
    when 'game_checkpoint' then v_limit := 8;
    else raise exception 'Unsupported competition action.' using errcode = '22023';
  end case;
  insert into private.competition_action_rate_limits as rate_limit (player_id, action, window_started_at, request_count, updated_at)
  values (p_player_id, p_action, v_window, 1, now())
  on conflict (player_id, action) do update set
    window_started_at = case when rate_limit.window_started_at = v_window then rate_limit.window_started_at else v_window end,
    request_count = case when rate_limit.window_started_at = v_window then rate_limit.request_count + 1 else 1 end,
    updated_at = now()
  returning request_count into v_count;
  return v_count <= v_limit;
end;
$$;

revoke all on function public.rtw_consume_competition_action_rate_limit(uuid, text) from public, anon, authenticated;
grant execute on function public.rtw_consume_competition_action_rate_limit(uuid, text) to service_role;
