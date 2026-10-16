-- Server-owned anti-automation observation for the weekly tournament.
-- This is a forward-only migration. It preserves historical sessions, runs,
-- rankings, awards, and ledger rows; it only gates newly finalized sessions.

alter table public.game_sessions
  add column anti_fraud_status text not null default 'verified'
    check (anti_fraud_status in ('verified', 'under_review', 'rejected'));

comment on column public.game_sessions.anti_fraud_status is
  'Server-selected anti-fraud disposition. Browser telemetry can request review but never establish validity.';

create table private.game_session_antifraud_observations (
  game_session_id uuid primary key references public.game_sessions(id) on delete restrict,
  player_id uuid not null references auth.users(id) on delete restrict,
  assessment_status text not null check (assessment_status in ('verified', 'under_review', 'rejected')),
  signal_codes text[] not null default '{}'::text[]
    check (cardinality(signal_codes) <= 3)
    check (signal_codes <@ array['uniform_input_cadence', 'webdriver_reported', 'untrusted_input_events']::text[]),
  input_count integer not null check (input_count between 0 and 4096),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid references auth.users(id) on delete restrict,
  resolution_note text,
  check ((resolved_at is null) = (resolved_by_user_id is null))
);

create index game_session_antifraud_review_queue_idx
  on private.game_session_antifraud_observations (created_at)
  where assessment_status = 'under_review';

-- One final resolution is immutable and idempotent. This prevents a retry or
-- racing administrator request from creating multiple conflicting decisions.
create table private.antifraud_review_decisions (
  review_id uuid primary key references public.fraud_reviews(id) on delete restrict,
  id uuid not null unique default gen_random_uuid(),
  validated_run_id uuid not null unique references public.validated_runs(id) on delete restrict,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text not null check (char_length(trim(reason)) between 1 and 500),
  decided_at timestamptz not null default now()
);

alter table private.admin_users
  add column can_authorize_final_payment boolean not null default false;

comment on column private.admin_users.can_authorize_final_payment is
  'Explicit owner-only gate for recording a final external payment. Defaults false so it fails closed until manually configured.';

-- Extend the immutable session guard: anti-fraud status may be set only by the
-- same server-side finalization transition that writes authoritative evidence.
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

  if (new.referral_eligible is distinct from old.referral_eligible
      or new.anti_fraud_status is distinct from old.anti_fraud_status)
    and (old.status <> 'active' or new.status <> 'finalized') then
    raise exception 'Server finalization evidence is immutable outside finalization.' using errcode = '23514';
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
      or new.final_collision_at_ms is distinct from old.final_collision_at_ms
      or new.anti_fraud_status is distinct from old.anti_fraud_status then
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
  select * into v_session from public.game_sessions where id = new.game_session_id for key share;
  if not found or v_session.status <> 'finalized' or v_session.final_score is null
    or v_session.final_distance_millimeters is null or v_session.final_elapsed_ms is null
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
  new.eligibility_status := case when v_session.anti_fraud_status = 'under_review' then 'under_review' else 'valid' end;
  new.referral_eligible := v_session.referral_eligible;
  new.status_updated_at := now();
  new.updated_at := now();
  return new;
end;
$$;

-- The extended signature keeps the status and observation in the same locked
-- finalization transaction. Only service_role has EXECUTE below.
drop function public.rtw_finalize_game_session_with_checkpoints(uuid, uuid, text, integer, integer, bigint, integer, integer, boolean, jsonb);
create function public.rtw_finalize_game_session_with_checkpoints(
  p_session_id uuid, p_player_id uuid, p_input_digest text, p_input_count integer,
  p_final_score integer, p_final_distance_millimeters bigint, p_final_elapsed_ms integer,
  p_final_collision_at_ms integer, p_referral_eligible boolean,
  p_antifraud_status text, p_antifraud_signals jsonb, p_checkpoint_proofs jsonb
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
  elsif v_session.gameplay_version = 'rtw-v7' and v_session.checkpoint_interval_score = 1000 and v_session.activity_lease_expires_at is not null then
    v_checkpoint_interval := 1000;
  else raise exception 'Official session has an invalid lifecycle.' using errcode = '23514'; end if;
  if v_session.gameplay_version = 'rtw-v7' and v_session.activity_lease_expires_at <= v_now then
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
$$;

create or replace function private.after_validated_run_change()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_game_id uuid; v_week_start date; v_player_id uuid; v_observation private.game_session_antifraud_observations%rowtype;
begin
  if tg_op = 'DELETE' then
    v_game_id := old.game_id; v_week_start := old.tournament_week_start; v_player_id := old.player_id;
  else
    v_game_id := new.game_id; v_week_start := new.tournament_week_start; v_player_id := new.player_id;
    if tg_op = 'INSERT' and new.eligibility_status = 'under_review' then
      select * into v_observation from private.game_session_antifraud_observations where game_session_id = new.game_session_id;
      insert into public.fraud_flags (player_id, game_id, subject_type, subject_id, severity, status, signal_summary, signal_data)
      values (new.player_id, new.game_id, 'validated_run', new.id, 'medium', 'under_review',
        'Server-observed anti-automation signals require review.', jsonb_build_object('signal_codes', coalesce(to_jsonb(v_observation.signal_codes), '[]'::jsonb)))
      on conflict do nothing;
      insert into public.fraud_reviews (subject_type, subject_id, status, decision_note)
      values ('validated_run', new.id, 'under_review', 'Server-observed anti-automation signals require review.')
      on conflict (subject_type, subject_id) do nothing;
    end if;
  end if;
  perform private.refresh_competition_week(v_game_id, v_week_start);
  perform private.refresh_referral_qualification(v_player_id);
  return null;
end;
$$;

create function public.rtw_admin_resolve_validated_run_antifraud_review(
  p_actor_user_id uuid, p_validated_run_id uuid, p_decision text, p_reason text
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_run public.validated_runs%rowtype; v_review public.fraud_reviews%rowtype; v_existing private.antifraud_review_decisions%rowtype;
begin
  if p_actor_user_id is null or p_validated_run_id is null or p_decision not in ('approved', 'rejected')
    or p_reason is null or char_length(trim(p_reason)) not between 1 and 500 then
    raise exception 'Invalid anti-fraud review decision.' using errcode = '22023';
  end if;
  if not exists (select 1 from private.admin_users where user_id = p_actor_user_id and is_active) then
    raise exception 'Administrator authorization is required.' using errcode = '42501';
  end if;
  select * into v_run from public.validated_runs where id = p_validated_run_id for update;
  if not found then raise exception 'Validated run is unavailable.' using errcode = 'P0002'; end if;
  select * into v_review from public.fraud_reviews where subject_type = 'validated_run' and subject_id = p_validated_run_id for update;
  if not found then raise exception 'Anti-fraud review is unavailable.' using errcode = '23514'; end if;
  select * into v_existing from private.antifraud_review_decisions where review_id = v_review.id;
  if found then
    if v_existing.decision = p_decision then return v_existing.decision; end if;
    raise exception 'Anti-fraud review is already resolved.' using errcode = '23514';
  end if;
  if v_run.eligibility_status <> 'under_review' or v_review.status <> 'under_review' then
    raise exception 'Validated run is not pending review.' using errcode = '23514';
  end if;
  insert into private.antifraud_review_decisions (review_id, validated_run_id, reviewer_user_id, decision, reason)
  values (v_review.id, p_validated_run_id, p_actor_user_id, p_decision, trim(p_reason));
  perform set_config('app.rtw_antifraud_resolution', 'on', true);
  update public.validated_runs set eligibility_status = case when p_decision = 'approved' then 'valid' else 'fraud_confirmed' end
    where id = p_validated_run_id;
  update public.fraud_reviews set status = case when p_decision = 'approved' then 'cleared' else 'fraud_confirmed' end,
    reviewer_user_id = p_actor_user_id, decision_note = trim(p_reason), decided_at = now(), updated_at = now() where id = v_review.id;
  update public.fraud_flags set status = case when p_decision = 'approved' then 'dismissed' else 'confirmed' end,
    resolved_by_user_id = p_actor_user_id, resolved_at = now(), updated_at = now()
    where subject_type = 'validated_run' and subject_id = p_validated_run_id and status in ('open', 'under_review');
  update private.game_session_antifraud_observations set assessment_status = case when p_decision = 'approved' then 'verified' else 'rejected' end,
    resolved_at = now(), resolved_by_user_id = p_actor_user_id, resolution_note = trim(p_reason)
    where game_session_id = v_run.game_session_id and assessment_status = 'under_review';
  return p_decision;
end;
$$;

-- Existing general eligibility tooling may not silently clear this dedicated,
-- auditable queue. It remains available for legacy non-observation cases.
create or replace function public.rtw_admin_set_validated_run_eligibility(
  p_actor_user_id uuid, p_validated_run_id uuid, p_status text, p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_run public.validated_runs%rowtype;
begin
  if not exists (select 1 from private.admin_users where user_id = p_actor_user_id and is_active) then raise exception 'Administrator authorization is required.' using errcode = '42501'; end if;
  if p_status not in ('valid', 'flagged', 'under_review', 'disqualified', 'fraud_confirmed') then raise exception 'Invalid run review status.' using errcode = '22023'; end if;
  if exists (select 1 from private.game_session_antifraud_observations as observation join public.validated_runs as run on run.game_session_id = observation.game_session_id
    where run.id = p_validated_run_id and observation.assessment_status = 'under_review') then
    raise exception 'Use the anti-fraud review resolver for this run.' using errcode = '23514';
  end if;
  update public.validated_runs set eligibility_status = p_status where id = p_validated_run_id returning * into v_run;
  if not found then raise exception 'Validated run unavailable.' using errcode = 'P0002'; end if;
  if p_status <> 'valid' then
    insert into public.fraud_flags (player_id, game_id, subject_type, subject_id, severity, status, signal_summary, created_by_user_id)
    values (v_run.player_id, v_run.game_id, 'validated_run', v_run.id, 'medium',
      case when p_status in ('fraud_confirmed', 'disqualified') then 'confirmed' else 'under_review' end,
      coalesce(nullif(left(trim(p_note), 500), ''), 'Administrative eligibility review'), p_actor_user_id);
  end if;
end;
$$;

-- Final external-payment recording is owner-only and fails closed. Normal
-- admin review and provisional award generation do not imply payment approval.
create or replace function public.rtw_admin_transition_winner(
  p_actor_user_id uuid, p_winner_id uuid, p_new_status text, p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_winner public.provisional_winners%rowtype;
begin
  if not exists (select 1 from private.admin_users where user_id = p_actor_user_id and is_active) then raise exception 'Administrator authorization is required.' using errcode = '42501'; end if;
  if p_new_status = 'paid' and not exists (select 1 from private.admin_users where user_id = p_actor_user_id and is_active and can_authorize_final_payment) then
    raise exception 'Owner payment authorization is required.' using errcode = '42501';
  end if;
  if p_new_status = 'paid' then
    perform set_config('app.rtw_owner_final_payment', p_actor_user_id::text, true);
  end if;
  select * into v_winner from public.provisional_winners where id = p_winner_id for update;
  if not found then raise exception 'Winner record unavailable.' using errcode = 'P0002'; end if;
  if p_new_status = 'disqualified' and v_winner.status = 'paid' then perform private.flag_paid_winner_for_review(v_winner, p_actor_user_id); return; end if;
  if p_new_status = 'disqualified' and v_winner.status = 'approved_for_payment' then if not private.reverse_provisional_winner_credit(v_winner.id, p_actor_user_id) then return; end if; end if;
  update public.provisional_winners set status = p_new_status, admin_note = coalesce(p_note, admin_note) where id = p_winner_id returning * into v_winner;
  if p_new_status = 'approved_for_payment' then
    if v_winner.allocation_status <> 'allocated' or v_winner.amount_cents is null then raise exception 'Winner allocation must be finalized before approval.' using errcode = '23514'; end if;
    insert into public.prize_ledger_entries (player_id, game_id, provisional_winner_id, entry_type, amount_cents, reason, created_by_user_id)
    values (v_winner.player_id, v_winner.game_id, v_winner.id, 'credit', v_winner.amount_cents, 'Approved provisional prize', p_actor_user_id)
    on conflict (provisional_winner_id) where entry_type = 'credit' do nothing;
  end if;
end;
$$;

-- service_role is a server principal, not a bypass for protected state
-- transitions. Direct REST/DML cannot set transaction-local guard settings.
create or replace function private.protect_validated_run_update()
returns trigger language plpgsql set search_path = '' as $$
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
  if new.eligibility_status is distinct from old.eligibility_status
    and exists (select 1 from private.game_session_antifraud_observations where game_session_id = old.game_session_id and assessment_status = 'under_review')
    and current_setting('app.rtw_antifraud_resolution', true) is distinct from 'on' then
    raise exception 'Pending anti-fraud review must use the audited resolver.' using errcode = '42501';
  end if;
  if new.eligibility_status is distinct from old.eligibility_status then new.status_updated_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.protect_provisional_winner()
returns trigger language plpgsql set search_path = '' as $$
declare v_owner_id uuid;
begin
  if new.id is distinct from old.id or new.game_id is distinct from old.game_id or new.player_id is distinct from old.player_id
    or new.tournament_week_start is distinct from old.tournament_week_start or new.award_type is distinct from old.award_type
    or new.rank_position is distinct from old.rank_position or new.amount_cents is distinct from old.amount_cents
    or new.allocation_status is distinct from old.allocation_status or new.claim_deadline_at is distinct from old.claim_deadline_at
    or new.created_at is distinct from old.created_at then
    raise exception 'Provisional winner award fields are immutable.' using errcode = '23514';
  end if;
  if new.status is distinct from old.status then
    if (old.status = 'provisional' and new.status not in ('claim_started', 'under_review', 'disqualified', 'expired'))
      or (old.status = 'claim_started' and new.status not in ('under_review', 'verified', 'disqualified', 'expired'))
      or (old.status = 'under_review' and new.status not in ('verified', 'disqualified'))
      or (old.status = 'verified' and new.status not in ('approved_for_payment', 'disqualified'))
      or (old.status = 'approved_for_payment' and new.status not in ('paid', 'disqualified'))
      or old.status in ('paid', 'expired', 'disqualified') then
      raise exception 'Invalid provisional winner state transition.' using errcode = '23514';
    end if;
  end if;
  if new.status = 'paid' and old.status is distinct from 'paid' then
    begin v_owner_id := nullif(current_setting('app.rtw_owner_final_payment', true), '')::uuid;
    exception when invalid_text_representation then v_owner_id := null; end;
    if not exists (select 1 from private.admin_users where user_id = v_owner_id and is_active and can_authorize_final_payment) then
      raise exception 'Owner payment authorization is required.' using errcode = '42501';
    end if;
  end if;
  if new.status = 'claim_started' and new.claim_started_at is null then new.claim_started_at := now(); end if;
  if new.status in ('verified', 'disqualified') and new.reviewed_at is null then new.reviewed_at := now(); end if;
  if new.status = 'approved_for_payment' and new.approved_at is null then new.approved_at := now(); end if;
  if new.status = 'paid' and new.paid_at is null then new.paid_at := now(); end if;
  new.updated_at := now(); return new;
end;
$$;

alter table private.game_session_antifraud_observations enable row level security;
alter table private.antifraud_review_decisions enable row level security;
revoke all on table private.game_session_antifraud_observations, private.antifraud_review_decisions from public, anon, authenticated;
grant select, insert, update on table private.game_session_antifraud_observations, private.antifraud_review_decisions to service_role;
revoke all on function public.rtw_finalize_game_session_with_checkpoints(uuid, uuid, text, integer, integer, bigint, integer, integer, boolean, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.rtw_admin_resolve_validated_run_antifraud_review(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.rtw_admin_set_validated_run_eligibility(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.rtw_admin_transition_winner(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.rtw_finalize_game_session_with_checkpoints(uuid, uuid, text, integer, integer, bigint, integer, integer, boolean, text, jsonb, jsonb) to service_role;
grant execute on function public.rtw_admin_resolve_validated_run_antifraud_review(uuid, uuid, text, text) to service_role;
grant execute on function public.rtw_admin_set_validated_run_eligibility(uuid, uuid, text, text) to service_role;
grant execute on function public.rtw_admin_transition_winner(uuid, uuid, text, text) to service_role;
revoke all on function private.protect_game_session_integrity(), private.materialize_validated_run(), private.after_validated_run_change() from public, anon, authenticated;
