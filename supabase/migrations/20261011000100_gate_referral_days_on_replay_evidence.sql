-- Keep score validity independent from referral qualification. Existing runs
-- are grandfathered; new runs receive referral evidence from the server-only
-- FINALIZE RPC after its authoritative replay has been analyzed.
alter table public.game_sessions
  add column referral_eligible boolean not null default false;

alter table public.validated_runs
  add column referral_eligible boolean not null default true;

comment on column public.game_sessions.referral_eligible is
  'Server-computed replay participation evidence. It does not affect score validity or rankings.';
comment on column public.validated_runs.referral_eligible is
  'Whether this otherwise-valid score has sufficient server-replayed participation evidence for referral days.';

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

  if new.referral_eligible is distinct from old.referral_eligible
    and (old.status <> 'active' or new.status <> 'finalized') then
    raise exception 'Referral evidence is immutable outside server finalization.' using errcode = '23514';
  end if;

  if old.gameplay_version = 'rtw-v6' then
    if new.activity_lease_expires_at is distinct from old.activity_lease_expires_at then
      raise exception 'Immutable game session fields cannot be changed.' using errcode = '23514';
    end if;
    if old.status <> 'active' then
      raise exception 'A completed or invalid session is immutable.' using errcode = '23514';
    end if;
    if new.status = 'active' then
      raise exception 'An active session cannot be rewritten.' using errcode = '23514';
    end if;
    if new.status = 'finalized' and new.finalized_at is null then
      raise exception 'A finalized session requires a server finalization time.' using errcode = '23514';
    end if;
    return new;
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

create or replace function private.materialize_validated_run()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
  v_completed_at timestamptz;
begin
  select * into v_session
  from public.game_sessions
  where id = new.game_session_id
  for key share;

  if not found
    or v_session.status <> 'finalized'
    or v_session.final_score is null
    or v_session.final_distance_millimeters is null
    or v_session.final_elapsed_ms is null
    or v_session.final_collision_at_ms is null then
    raise exception 'Validated runs require a finalized authoritative session.' using errcode = '23514';
  end if;

  v_completed_at := v_session.started_at + (v_session.final_elapsed_ms * interval '1 millisecond');
  new.player_id := v_session.user_id;
  new.game_id := v_session.game_id;
  new.score := v_session.final_score;
  new.distance_millimeters := v_session.final_distance_millimeters;
  new.elapsed_ms := v_session.final_elapsed_ms;
  new.collision_at_ms := v_session.final_collision_at_ms;
  new.score_multiplier := 1;
  new.extra_life_used := false;
  new.completed_at := v_completed_at;
  new.tournament_day := private.ny_tournament_day(v_completed_at);
  new.tournament_week_start := private.ny_tournament_week_start(v_completed_at);
  new.eligibility_status := 'valid';
  new.referral_eligible := v_session.referral_eligible;
  new.status_updated_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.protect_validated_run_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.game_session_id is distinct from old.game_session_id
    or new.player_id is distinct from old.player_id
    or new.game_id is distinct from old.game_id
    or new.score is distinct from old.score
    or new.distance_millimeters is distinct from old.distance_millimeters
    or new.elapsed_ms is distinct from old.elapsed_ms
    or new.collision_at_ms is distinct from old.collision_at_ms
    or new.score_multiplier is distinct from old.score_multiplier
    or new.extra_life_used is distinct from old.extra_life_used
    or new.completed_at is distinct from old.completed_at
    or new.tournament_day is distinct from old.tournament_day
    or new.tournament_week_start is distinct from old.tournament_week_start
    or new.referral_eligible is distinct from old.referral_eligible
    or new.created_at is distinct from old.created_at then
    raise exception 'Authoritative run fields are immutable.' using errcode = '23514';
  end if;

  if new.eligibility_status is distinct from old.eligibility_status then
    new.status_updated_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.refresh_referral_qualification(p_invitee_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_referral public.referrals%rowtype;
  v_qualified_day_count integer;
  v_completion_day date;
begin
  select * into v_referral
  from public.referrals
  where invitee_user_id = p_invitee_user_id
  for update;
  if not found then return; end if;

  if not exists (
    select 1 from auth.users as user_record
    where user_record.id = p_invitee_user_id
      and user_record.email_confirmed_at is not null
  ) then
    return;
  end if;

  insert into public.referral_qualification_days (
    referral_id, qualification_day, valid_run_count, status
  )
  select
    v_referral.id,
    run.tournament_day,
    count(*)::integer,
    'valid'
  from public.validated_runs as run
  where run.player_id = p_invitee_user_id
    and run.game_id = v_referral.game_id
    and run.eligibility_status = 'valid'
    and run.referral_eligible
    and run.completed_at >= v_referral.attached_at
  group by run.tournament_day
  having count(*) >= 3
  on conflict (referral_id, qualification_day) do update
    set valid_run_count = excluded.valid_run_count,
        status = 'valid',
        last_recalculated_at = now();

  update public.referral_qualification_days as qualification
  set status = 'disqualified', last_recalculated_at = now()
  where qualification.referral_id = v_referral.id
    and qualification.status = 'valid'
    and not exists (
      select 1
      from public.validated_runs as run
      where run.player_id = p_invitee_user_id
        and run.game_id = v_referral.game_id
        and run.eligibility_status = 'valid'
        and run.referral_eligible
        and run.completed_at >= v_referral.attached_at
        and run.tournament_day = qualification.qualification_day
      group by run.tournament_day
      having count(*) >= 3
    );

  if v_referral.confirmed_tournament_week_start is not null then
    select count(*), max(qualification_day)
    into v_qualified_day_count, v_completion_day
    from public.referral_qualification_days
    where referral_id = v_referral.id
      and status = 'valid'
      and private.week_start_for_date(qualification_day) = v_referral.confirmed_tournament_week_start;
  else
    select count(*)::integer, (array_agg(qualification_day order by qualification_day))[5]
    into v_qualified_day_count, v_completion_day
    from public.referral_qualification_days
    where referral_id = v_referral.id
      and status = 'valid'
    group by private.week_start_for_date(qualification_day)
    order by (count(*) >= 5) desc,
      case when count(*) >= 5 then private.week_start_for_date(qualification_day) end asc,
      count(*) desc,
      private.week_start_for_date(qualification_day) asc
    limit 1;
    v_qualified_day_count := coalesce(v_qualified_day_count, 0);
  end if;

  update public.referrals
  set qualified_day_count = v_qualified_day_count,
      updated_at = now()
  where id = v_referral.id;

  if v_qualified_day_count >= 5 and v_referral.status = 'invite_pending' then
    update public.referrals
    set status = 'valid',
        confirmed_at = now(),
        confirmed_tournament_week_start = private.week_start_for_date(v_completion_day),
        updated_at = now()
    where id = v_referral.id;
  elsif v_qualified_day_count < 5 and v_referral.status = 'valid' then
    update public.referrals
    set status = 'under_review', updated_at = now()
    where id = v_referral.id;
  end if;
end;
$$;

drop function public.rtw_finalize_game_session_with_checkpoints(uuid, uuid, text, integer, integer, bigint, integer, integer, jsonb);

create function public.rtw_finalize_game_session_with_checkpoints(
  p_session_id uuid,
  p_player_id uuid,
  p_input_digest text,
  p_input_count integer,
  p_final_score integer,
  p_final_distance_millimeters bigint,
  p_final_elapsed_ms integer,
  p_final_collision_at_ms integer,
  p_referral_eligible boolean,
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
  v_checkpoint_interval integer;
  v_now timestamptz := now();
begin
  if p_input_digest is null or p_input_digest !~ '^[a-f0-9]{64}$'
    or p_input_count is null or p_input_count not between 0 and 4096
    or p_final_score is null or p_final_score < 0
    or p_final_distance_millimeters is null or p_final_distance_millimeters < 0
    or p_final_elapsed_ms is null or p_final_elapsed_ms < 0
    or p_final_collision_at_ms is null or p_final_collision_at_ms < 0
    or p_final_collision_at_ms > p_final_elapsed_ms
    or p_referral_eligible is null
    or p_checkpoint_proofs is null or jsonb_typeof(p_checkpoint_proofs) <> 'array' then
    raise exception 'Invalid server finalization evidence.' using errcode = '22023';
  end if;

  select * into v_session from public.game_sessions
  where id = p_session_id and user_id = p_player_id for update;
  if not found then raise exception 'Official session is unavailable.' using errcode = 'P0002'; end if;
  if v_session.status <> 'active' then raise exception 'Official session is not active.' using errcode = '23514'; end if;
  if v_session.gameplay_version = 'rtw-v6' then
    if v_session.expires_at <= v_now then
      raise exception 'Official session is not active.' using errcode = '23514';
    end if;
    v_checkpoint_interval := 5000;
  elsif v_session.gameplay_version = 'rtw-v7'
    and v_session.checkpoint_interval_score = 1000
    and v_session.activity_lease_expires_at is not null then
    v_checkpoint_interval := 1000;
  else
    raise exception 'Official session has an invalid lifecycle.' using errcode = '23514';
  end if;
  if v_session.gameplay_version = 'rtw-v7' and v_session.activity_lease_expires_at <= v_now then
    update public.game_sessions as session
    set status = 'expired', invalidated_at = v_now, invalidation_reason = 'activity_lease_expired'
    where session.id = v_session.id and session.status = 'active';
    raise exception 'Official session activity lease has expired.' using errcode = '23514';
  end if;

  v_required_count := floor(p_final_score / v_checkpoint_interval::numeric)::integer;
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
        v_index * v_checkpoint_interval, p_input_digest, p_input_count
      );
    end if;
  end loop;

  return query update public.game_sessions as session
  set status = 'finalized', finalized_at = v_now, input_digest = p_input_digest,
      input_count = p_input_count, final_score = p_final_score,
      final_distance_millimeters = p_final_distance_millimeters,
      final_elapsed_ms = p_final_elapsed_ms, final_collision_at_ms = p_final_collision_at_ms,
      referral_eligible = p_referral_eligible
  where session.id = p_session_id and session.user_id = p_player_id and session.status = 'active'
  returning session.status, session.input_digest, session.final_score,
    session.final_distance_millimeters, session.final_elapsed_ms, session.final_collision_at_ms;
end;
$$;

revoke all on function public.rtw_finalize_game_session_with_checkpoints(uuid, uuid, text, integer, integer, bigint, integer, integer, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.rtw_finalize_game_session_with_checkpoints(uuid, uuid, text, integer, integer, bigint, integer, integer, boolean, jsonb) to service_role;