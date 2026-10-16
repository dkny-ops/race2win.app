-- A narrowly-scoped, post-run human verification gate.  This never accepts a
-- browser score and never credits a prize: it only permits an already replay-
-- validated run to re-enter normal weekly eligibility after server verification.

create table private.weekly_leadership_state (
  game_id uuid not null references public.games(id) on delete restrict,
  tournament_week_start date not null,
  leader_player_id uuid references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (game_id, tournament_week_start)
);

create table private.weekly_leader_human_verifications (
  id uuid primary key default gen_random_uuid(),
  validated_run_id uuid not null unique references public.validated_runs(id) on delete restrict,
  game_session_id uuid not null unique references public.game_sessions(id) on delete restrict,
  player_id uuid not null references auth.users(id) on delete restrict,
  game_id uuid not null references public.games(id) on delete restrict,
  tournament_week_start date not null,
  reason text not null check (reason in ('weekly_leadership', 'corroborated_automation_signals')),
  status text not null default 'pending' check (status in ('pending', 'verified', 'expired')),
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'verified') = (verified_at is not null)),
  check (expires_at <= created_at + interval '24 hours')
);

create index weekly_leader_human_verifications_pending_idx
  on private.weekly_leader_human_verifications (player_id, tournament_week_start, expires_at)
  where status = 'pending';

comment on table private.weekly_leader_human_verifications is
  'Server-only, short-lived Turnstile step-up records. Tokens are never stored.';

-- The state is deliberately based only on eligible, server-derived totals.
-- Exact ties have no automatic leader and therefore no automatic winner.
create or replace function private.refresh_weekly_leadership_state(p_game_id uuid, p_week_start date)
returns void language plpgsql set search_path = '' as $$
declare v_leader uuid;
begin
  select player_id into v_leader
  from public.weekly_tournament_totals
  where game_id = p_game_id and tournament_week_start = p_week_start
    and rank_position = 1 and tie_break_status = 'resolved'
  limit 1;
  insert into private.weekly_leadership_state (game_id, tournament_week_start, leader_player_id, updated_at)
  values (p_game_id, p_week_start, v_leader, now())
  on conflict (game_id, tournament_week_start) do update
    set leader_player_id = excluded.leader_player_id, updated_at = excluded.updated_at;
end;
$$;

-- This trigger runs after the established competition refresh trigger (the
-- names are intentionally ordered). It sees the computed weekly rank, not a
-- client-supplied total. A qualifying new leader is immediately held in this
-- same transaction, which triggers the normal rebuild without that run.
create or replace function private.require_weekly_leader_human_verification()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_previous_leader uuid;
  v_current_leader uuid;
  v_tied boolean;
  v_existing_verified boolean;
  v_observation_status text;
  v_reason text;
begin
  if new.eligibility_status <> 'valid' then return null; end if;
  -- Historical rtw-v6 results retain their original semantics. New official
  -- rtw-v7 sessions are the only sessions capable of entering this step-up.
  if not exists (
    select 1 from public.game_sessions
    where id = new.game_session_id and gameplay_version = 'rtw-v7'
  ) then return null; end if;

  select leader_player_id into v_previous_leader
  from private.weekly_leadership_state
  where game_id = new.game_id and tournament_week_start = new.tournament_week_start
  for update;

  select player_id, tie_break_status = 'exact_tie' into v_current_leader, v_tied
  from public.weekly_tournament_totals
  where game_id = new.game_id and tournament_week_start = new.tournament_week_start and rank_position = 1
  limit 1;

  -- A strictly-resolved first place is the only automatic leadership event.
  if v_current_leader = new.player_id and coalesce(v_tied, false) = false then
    select exists(
      select 1 from private.weekly_leader_human_verifications
      where player_id = new.player_id and game_id = new.game_id
        and tournament_week_start = new.tournament_week_start
        and status = 'verified' and reason = 'weekly_leadership'
    ) into v_existing_verified;
    if v_previous_leader is distinct from new.player_id or not v_existing_verified then
      v_reason := 'weekly_leadership';
    end if;
  end if;

  -- Corroborated server-observed signals do not prove a bot and do not clear
  -- the existing human review. They may request an additional step-up only.
  select assessment_status into v_observation_status
  from private.game_session_antifraud_observations where game_session_id = new.game_session_id;
  if v_reason is null and v_observation_status = 'under_review' then
    v_reason := 'corroborated_automation_signals';
  end if;

  if v_reason is not null then
    insert into private.weekly_leader_human_verifications
      (validated_run_id, game_session_id, player_id, game_id, tournament_week_start, reason, expires_at)
    values (new.id, new.game_session_id, new.player_id, new.game_id, new.tournament_week_start, v_reason, now() + interval '15 minutes')
    on conflict (validated_run_id) do nothing;
    if v_reason = 'weekly_leadership' then
      perform set_config('app.rtw_weekly_leader_human_verification', 'on', true);
      update public.validated_runs set eligibility_status = 'under_review' where id = new.id;
    end if;
  end if;
  return null;
end;
$$;

-- Keep the prior leader snapshot after every material change, including the
-- nested hold update above. This makes a later reclaim a fresh challenge.
create or replace function private.record_weekly_leadership_state()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform private.refresh_weekly_leadership_state(
    coalesce(new.game_id, old.game_id), coalesce(new.tournament_week_start, old.tournament_week_start)
  );
  return null;
end;
$$;

create trigger validated_runs_require_weekly_leader_human_verification
  after insert on public.validated_runs
  for each row execute function private.require_weekly_leader_human_verification();

create trigger validated_runs_z_record_weekly_leadership_state
  after insert or update of eligibility_status or delete on public.validated_runs
  for each row execute function private.record_weekly_leadership_state();

-- A held leadership run cannot be moved by direct service-role REST/DML. Only
-- the scoped verifier below sets the transaction-local guard.
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
  if new.eligibility_status is distinct from old.eligibility_status
    and exists (select 1 from private.weekly_leader_human_verifications where validated_run_id = old.id and status = 'pending' and reason = 'weekly_leadership')
    and current_setting('app.rtw_weekly_leader_human_verification', true) is distinct from 'on' then
    raise exception 'Pending human verification must use the scoped verifier.' using errcode = '42501';
  end if;
  if new.eligibility_status is distinct from old.eligibility_status then new.status_updated_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;

create function public.rtw_read_weekly_leader_human_verification(p_session_id uuid, p_player_id uuid)
returns table (required boolean, status text, expires_at timestamptz, widget_required boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if p_session_id is null or p_player_id is null then raise exception 'Invalid verification request.' using errcode = '22023'; end if;
  return query
  select true, case when verification.status = 'pending' and verification.expires_at <= now() then 'expired' else verification.status end,
    verification.expires_at, verification.reason = 'weekly_leadership'
  from private.weekly_leader_human_verifications as verification
  join public.game_sessions as session on session.id = verification.game_session_id
  where verification.game_session_id = p_session_id and verification.player_id = p_player_id and session.user_id = p_player_id
  limit 1;
end;
$$;

-- A retry creates no new result, session, or prize. It only renews the
-- short-lived local scope after expiry so the player can obtain a fresh
-- provider token. Failed provider attempts never consume this record.
create function public.rtw_begin_weekly_leader_human_verification(p_session_id uuid, p_player_id uuid)
returns table (required boolean, status text, expires_at timestamptz, widget_required boolean)
language plpgsql security definer set search_path = '' as $$
declare v_verification private.weekly_leader_human_verifications%rowtype;
begin
  if p_session_id is null or p_player_id is null then raise exception 'Invalid verification request.' using errcode = '22023'; end if;
  select * into v_verification from private.weekly_leader_human_verifications
    where game_session_id = p_session_id and player_id = p_player_id for update;
  if not found then return; end if;
  if v_verification.status = 'expired' or (v_verification.status = 'pending' and v_verification.expires_at <= now()) then
    update private.weekly_leader_human_verifications
      set status = 'pending', expires_at = now() + interval '15 minutes', updated_at = now()
      where id = v_verification.id;
    select * into v_verification from private.weekly_leader_human_verifications where id = v_verification.id;
  end if;
  return query select true, v_verification.status, v_verification.expires_at, v_verification.reason = 'weekly_leadership';
end;
$$;

-- The caller has already asked Cloudflare to consume the token. This RPC has
-- no token argument and cannot be used as a token-verification bypass.
create function public.rtw_verify_weekly_leader_human_verification(p_session_id uuid, p_player_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_verification private.weekly_leader_human_verifications%rowtype; v_run public.validated_runs%rowtype;
begin
  if p_session_id is null or p_player_id is null then raise exception 'Invalid verification request.' using errcode = '22023'; end if;
  select * into v_verification from private.weekly_leader_human_verifications
    where game_session_id = p_session_id and player_id = p_player_id for update;
  if not found then raise exception 'Verification is unavailable.' using errcode = 'P0002'; end if;
  if v_verification.status = 'verified' then return 'verified'; end if;
  if v_verification.expires_at <= now() then
    update private.weekly_leader_human_verifications set status = 'expired', updated_at = now() where id = v_verification.id;
    raise exception 'Verification has expired.' using errcode = '23514';
  end if;
  if v_verification.reason <> 'weekly_leadership' then return 'recorded_for_review'; end if;
  select * into v_run from public.validated_runs where id = v_verification.validated_run_id for update;
  if not found or v_run.eligibility_status <> 'under_review' then raise exception 'Verification is no longer pending.' using errcode = '23514'; end if;
  perform set_config('app.rtw_weekly_leader_human_verification', 'on', true);
  update public.validated_runs set eligibility_status = 'valid' where id = v_run.id;
  update private.weekly_leader_human_verifications set status = 'verified', verified_at = now(), updated_at = now() where id = v_verification.id;
  return 'verified';
end;
$$;

alter table private.weekly_leadership_state enable row level security;
alter table private.weekly_leader_human_verifications enable row level security;
revoke all on table private.weekly_leadership_state, private.weekly_leader_human_verifications from public, anon, authenticated;
grant select, insert, update on table private.weekly_leadership_state, private.weekly_leader_human_verifications to service_role;
revoke all on function private.refresh_weekly_leadership_state(uuid, date), private.require_weekly_leader_human_verification(), private.record_weekly_leadership_state() from public, anon, authenticated;
revoke all on function public.rtw_read_weekly_leader_human_verification(uuid, uuid), public.rtw_begin_weekly_leader_human_verification(uuid, uuid), public.rtw_verify_weekly_leader_human_verification(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rtw_read_weekly_leader_human_verification(uuid, uuid), public.rtw_begin_weekly_leader_human_verification(uuid, uuid), public.rtw_verify_weekly_leader_human_verification(uuid, uuid) to service_role;
