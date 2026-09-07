-- Race To Win competition foundation.
--
-- This migration is intentionally server-owned. The browser has no grants to
-- mutate competitive, referral, reward, review, or payout state. All dates
-- that affect a tournament are derived in PostgreSQL using America/New_York.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Shared, database-owned mutation quotas. A row is keyed by the verified
-- player and action, so limits remain effective across stateless app instances.
create table private.competition_action_rate_limits (
  player_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('referral_attach', 'prize_claim', 'balance_claim')),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (player_id, action)
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  status text not null default 'active' check (status in ('active', 'paused', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.games (slug, display_name)
values ('race-to-win', 'Race To Win')
on conflict (slug) do nothing;

-- Preserve any existing authoritative session history while replacing the
-- single-game text check with a foreign key to the game catalogue.
alter table public.game_sessions add column game_uuid uuid;

update public.game_sessions as session
set game_uuid = game.id
from public.games as game
where game.slug = 'race-to-win'
  and session.game_id = 'race-to-win';

alter table public.game_sessions alter column game_uuid set not null;
alter table public.game_sessions
  add constraint game_sessions_game_uuid_fkey
  foreign key (game_uuid) references public.games(id) on delete restrict;
alter table public.game_sessions drop constraint game_sessions_game_id_check;
alter table public.game_sessions drop column game_id;
alter table public.game_sessions rename column game_uuid to game_id;

create index game_sessions_game_player_created_at_idx
  on public.game_sessions (game_id, user_id, created_at desc);

create function private.ny_tournament_day(p_value timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_value at time zone 'America/New_York')::date;
$$;

create function private.week_start_for_date(p_day date)
returns date
language sql
immutable
set search_path = ''
as $$
  select date_trunc('week', p_day::timestamp)::date;
$$;

create function private.ny_tournament_week_start(p_value timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select private.week_start_for_date(private.ny_tournament_day(p_value));
$$;

revoke all on function private.ny_tournament_day(timestamptz) from public, anon, authenticated;
revoke all on function private.week_start_for_date(date) from public, anon, authenticated;
revoke all on function private.ny_tournament_week_start(timestamptz) from public, anon, authenticated;

create table public.validated_runs (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null unique references public.game_sessions(id) on delete restrict,
  player_id uuid not null references auth.users(id) on delete restrict,
  game_id uuid not null references public.games(id) on delete restrict,
  score integer not null check (score >= 0),
  distance_millimeters bigint not null check (distance_millimeters >= 0),
  elapsed_ms integer not null check (elapsed_ms >= 0),
  collision_at_ms integer not null check (collision_at_ms >= 0 and collision_at_ms <= elapsed_ms),
  score_multiplier smallint not null default 1 check (score_multiplier in (1, 2)),
  extra_life_used boolean not null default false,
  completed_at timestamptz not null,
  tournament_day date not null,
  tournament_week_start date not null,
  eligibility_status text not null default 'valid'
    check (eligibility_status in ('valid', 'flagged', 'under_review', 'disqualified', 'fraud_confirmed')),
  status_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint validated_runs_day_matches_week check (
    tournament_week_start = private.week_start_for_date(tournament_day)
  )
);

create index validated_runs_game_day_score_idx
  on public.validated_runs (game_id, tournament_day, player_id, score desc, completed_at asc);
create index validated_runs_game_week_score_idx
  on public.validated_runs (game_id, tournament_week_start, player_id, score desc, completed_at asc);
create index validated_runs_player_created_at_idx
  on public.validated_runs (player_id, created_at desc);
create index validated_runs_review_queue_idx
  on public.validated_runs (eligibility_status, created_at)
  where eligibility_status <> 'valid';

create table public.daily_top_scores (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete restrict,
  player_id uuid not null references auth.users(id) on delete restrict,
  tournament_day date not null,
  tournament_week_start date not null,
  daily_rank smallint not null check (daily_rank between 1 and 7),
  validated_run_id uuid not null unique references public.validated_runs(id) on delete restrict,
  score integer not null check (score >= 0),
  created_at timestamptz not null default now(),
  constraint daily_top_scores_day_matches_week check (
    tournament_week_start = private.week_start_for_date(tournament_day)
  ),
  unique (game_id, player_id, tournament_day, daily_rank)
);

create index daily_top_scores_week_player_idx
  on public.daily_top_scores (game_id, tournament_week_start, player_id, tournament_day, daily_rank);

create table public.weekly_tournament_totals (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete restrict,
  player_id uuid not null references auth.users(id) on delete restrict,
  tournament_week_start date not null,
  weekly_total_score bigint not null check (weekly_total_score >= 0),
  -- All valid weekly scores, not only Top 7, ordered high-to-low for tie breaks.
  individual_scores integer[] not null default '{}'::integer[],
  rank_position integer not null check (rank_position > 0),
  tie_break_status text not null check (tie_break_status in ('resolved', 'exact_tie')),
  calculated_at timestamptz not null default now(),
  unique (game_id, player_id, tournament_week_start)
);

create index weekly_tournament_totals_ranking_idx
  on public.weekly_tournament_totals (game_id, tournament_week_start, weekly_total_score desc, rank_position);
create index weekly_tournament_totals_player_idx
  on public.weekly_tournament_totals (player_id, tournament_week_start desc);

create table public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  game_id uuid not null references public.games(id) on delete restrict,
  code text not null unique check (code ~ '^[A-Z0-9]{10,32}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (owner_user_id, game_id)
);

create index referral_codes_lookup_idx
  on public.referral_codes (code)
  where revoked_at is null;

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete restrict,
  referral_code_id uuid not null references public.referral_codes(id) on delete restrict,
  inviter_user_id uuid not null references auth.users(id) on delete restrict,
  invitee_user_id uuid not null unique references auth.users(id) on delete restrict,
  status text not null default 'invite_pending'
    check (status in ('invite_pending', 'valid', 'flagged', 'under_review', 'disqualified', 'fraud_confirmed')),
  qualified_day_count smallint not null default 0 check (qualified_day_count >= 0),
  confirmed_at timestamptz,
  confirmed_tournament_week_start date,
  -- Set by a database trigger, never by a caller. Qualification only counts
  -- authoritative runs completed at or after this timestamp.
  attached_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referrals_not_self check (inviter_user_id <> invitee_user_id),
  constraint referrals_confirmation_shape check (
    -- A referral may be flagged before it qualifies, but a valid referral must
    -- retain the immutable evidence of the week in which it qualified.
    (confirmed_at is null) = (confirmed_tournament_week_start is null)
    and (
      status <> 'valid'
      or (confirmed_at is not null and confirmed_tournament_week_start is not null)
    )
  )
);

create index referrals_inviter_status_idx
  on public.referrals (game_id, inviter_user_id, status, confirmed_tournament_week_start);
create index referrals_invitee_idx on public.referrals (invitee_user_id);
create index referrals_confirmation_week_idx
  on public.referrals (game_id, confirmed_tournament_week_start, inviter_user_id)
  where status = 'valid';

create table public.referral_qualification_days (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals(id) on delete restrict,
  qualification_day date not null,
  valid_run_count integer not null check (valid_run_count >= 3),
  status text not null default 'valid' check (status in ('valid', 'disqualified')),
  first_qualified_at timestamptz not null default now(),
  last_recalculated_at timestamptz not null default now(),
  unique (referral_id, qualification_day)
);

create index referral_qualification_days_referral_idx
  on public.referral_qualification_days (referral_id, status, qualification_day);

create table public.weekly_share_results (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete restrict,
  tournament_week_start date not null,
  player_id uuid not null references auth.users(id) on delete restrict,
  confirmed_share_count integer not null check (confirmed_share_count > 0),
  rank_position integer not null check (rank_position > 0),
  is_winner boolean not null default false,
  calculated_at timestamptz not null default now(),
  unique (game_id, tournament_week_start, player_id)
);

create index weekly_share_results_ranking_idx
  on public.weekly_share_results (game_id, tournament_week_start, confirmed_share_count desc, rank_position);

create table public.ad_reward_claims (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null unique references public.game_sessions(id) on delete restrict,
  player_id uuid not null references auth.users(id) on delete restrict,
  game_id uuid not null references public.games(id) on delete restrict,
  reward_type text not null check (reward_type in ('extra_life', 'double_points')),
  provider_name text not null check (char_length(provider_name) between 1 and 80),
  provider_event_id text unique,
  provider_payload_digest text check (provider_payload_digest is null or provider_payload_digest ~ '^[a-f0-9]{64}$'),
  verification_status text not null default 'requested'
    check (verification_status in ('requested', 'verified', 'rejected', 'expired', 'consumed')),
  requested_at timestamptz not null default now(),
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_reward_claims_verified_shape check (
    verification_status <> 'verified' or (provider_event_id is not null and verified_at is not null)
  )
);

-- No provider is integrated yet. This table deliberately has no browser
-- endpoint: a future provider must verify a signed server-side callback before
-- setting verification_status to verified or consuming a reward.
create table public.normal_ad_delivery_events (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete restrict,
  game_id uuid not null references public.games(id) on delete restrict,
  validated_run_id uuid references public.validated_runs(id) on delete restrict,
  provider_name text not null check (char_length(provider_name) between 1 and 80),
  provider_event_id text unique,
  delivery_status text not null default 'requested'
    check (delivery_status in ('requested', 'verified', 'failed')),
  created_at timestamptz not null default now()
);

create index normal_ad_delivery_events_player_game_idx
  on public.normal_ad_delivery_events (player_id, game_id, created_at desc);

-- Rewarded-ad data is provider/server owned. Even a future service_role
-- integration cannot attach a claimed reward to an arbitrary player or game.
-- The unique session key makes Extra Life and 2x Points mutually exclusive.
create function private.guard_ad_reward_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_session
    from public.game_sessions
    where id = new.game_session_id
    for key share;
    if not found or v_session.status <> 'active' then
      raise exception 'Reward claims require an active server session.' using errcode = '23514';
    end if;
    if new.verification_status <> 'requested' or new.provider_event_id is not null or new.verified_at is not null or new.consumed_at is not null then
      raise exception 'A reward claim must begin pending provider verification.' using errcode = '23514';
    end if;
    new.player_id := v_session.user_id;
    new.game_id := v_session.game_id;
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
    or new.game_session_id is distinct from old.game_session_id
    or new.player_id is distinct from old.player_id
    or new.game_id is distinct from old.game_id
    or new.reward_type is distinct from old.reward_type
    or new.provider_name is distinct from old.provider_name
    or new.requested_at is distinct from old.requested_at
    or new.created_at is distinct from old.created_at then
    raise exception 'Reward claim ownership is immutable.' using errcode = '23514';
  end if;
  if (old.verification_status = 'requested' and new.verification_status not in ('verified', 'rejected', 'expired'))
    or (old.verification_status = 'verified' and new.verification_status not in ('consumed', 'expired'))
    or old.verification_status in ('rejected', 'expired', 'consumed') then
    raise exception 'Invalid rewarded-ad state transition.' using errcode = '23514';
  end if;
  if old.verification_status <> 'requested'
    and (new.provider_event_id is distinct from old.provider_event_id or new.provider_payload_digest is distinct from old.provider_payload_digest) then
    raise exception 'Provider verification evidence is immutable.' using errcode = '23514';
  end if;
  if new.verification_status = 'verified' and (new.provider_event_id is null or new.provider_payload_digest is null or new.verified_at is null) then
    raise exception 'Verified rewards require provider evidence.' using errcode = '23514';
  end if;
  if new.verification_status = 'consumed' and new.consumed_at is null then new.consumed_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger ad_reward_claims_guard
  before insert or update on public.ad_reward_claims
  for each row execute function private.guard_ad_reward_claim();

create table public.fraud_flags (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references auth.users(id) on delete restrict,
  game_id uuid references public.games(id) on delete restrict,
  subject_type text not null check (subject_type in ('player', 'validated_run', 'referral', 'provisional_winner', 'payout')),
  subject_id uuid not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'under_review', 'confirmed', 'dismissed')),
  signal_summary text not null check (char_length(signal_summary) between 1 and 500),
  signal_data jsonb not null default '{}'::jsonb check (jsonb_typeof(signal_data) = 'object'),
  created_by_user_id uuid references auth.users(id) on delete restrict,
  resolved_by_user_id uuid references auth.users(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fraud_flags_review_queue_idx
  on public.fraud_flags (status, severity desc, created_at)
  where status in ('open', 'under_review');
create index fraud_flags_subject_idx on public.fraud_flags (subject_type, subject_id);
create index fraud_flags_player_idx on public.fraud_flags (player_id, created_at desc);

create table public.fraud_reviews (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('validated_run', 'referral', 'provisional_winner', 'payout')),
  subject_id uuid not null,
  status text not null default 'under_review'
    check (status in ('under_review', 'cleared', 'disqualified', 'fraud_confirmed')),
  reviewer_user_id uuid references auth.users(id) on delete restrict,
  decision_note text,
  opened_at timestamptz not null default now(),
  decided_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (subject_type, subject_id)
);

create index fraud_reviews_queue_idx
  on public.fraud_reviews (status, opened_at)
  where status = 'under_review';

create table public.provisional_winners (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete restrict,
  player_id uuid not null references auth.users(id) on delete restrict,
  tournament_week_start date not null,
  award_type text not null check (award_type in ('weekly_tournament', 'weekly_shares')),
  rank_position integer check (rank_position > 0),
  amount_cents integer check (amount_cents is null or amount_cents > 0),
  allocation_status text not null default 'allocated'
    check (allocation_status in ('allocated', 'requires_manual_allocation')),
  status text not null default 'provisional'
    check (status in ('provisional', 'claim_started', 'under_review', 'verified', 'disqualified', 'approved_for_payment', 'paid', 'expired')),
  claim_deadline_at timestamptz not null,
  claim_started_at timestamptz,
  reviewed_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provisional_winners_amount_shape check (
    (allocation_status = 'allocated' and amount_cents is not null)
    or (allocation_status = 'requires_manual_allocation' and amount_cents is null)
  ),
  unique (game_id, tournament_week_start, award_type, player_id)
);

create index provisional_winners_player_claim_idx
  on public.provisional_winners (player_id, status, claim_deadline_at);
create index provisional_winners_review_queue_idx
  on public.provisional_winners (status, created_at)
  where status in ('provisional', 'claim_started', 'under_review', 'verified', 'approved_for_payment');

create table public.prize_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete restrict,
  game_id uuid not null references public.games(id) on delete restrict,
  provisional_winner_id uuid references public.provisional_winners(id) on delete restrict,
  payout_id uuid,
  reverses_ledger_entry_id uuid,
  entry_type text not null check (entry_type in ('credit', 'credit_reversal', 'payout_hold', 'payout_release', 'payout_settlement', 'manual_adjustment')),
  amount_cents integer not null check (amount_cents <> 0),
  reason text not null check (char_length(reason) between 1 and 240),
  created_by_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint prize_ledger_entry_sign check (
    (entry_type in ('credit', 'payout_release', 'manual_adjustment') and amount_cents > 0)
    or (entry_type in ('credit_reversal', 'payout_hold', 'payout_settlement') and amount_cents < 0)
  ),
  constraint prize_ledger_reversal_shape check (
    (entry_type = 'credit_reversal') = (reverses_ledger_entry_id is not null)
  )
);

create index prize_ledger_entries_player_created_idx
  on public.prize_ledger_entries (player_id, created_at desc);
create index prize_ledger_entries_game_player_idx
  on public.prize_ledger_entries (game_id, player_id, created_at desc);

create table public.prize_balances (
  player_id uuid primary key references auth.users(id) on delete restrict,
  available_cents bigint not null default 0 check (available_cents >= 0),
  updated_at timestamptz not null default now()
);

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete restrict,
  amount_cents integer not null check (amount_cents >= 1000),
  status text not null default 'requested'
    check (status in ('requested', 'under_review', 'approved', 'paid', 'failed', 'cancelled', 'expired')),
  payout_reference text unique,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.prize_ledger_entries
  add constraint prize_ledger_entries_payout_fkey
  foreign key (payout_id) references public.payouts(id) on delete restrict;

alter table public.prize_ledger_entries
  add constraint prize_ledger_entries_reverses_fkey
  foreign key (reverses_ledger_entry_id) references public.prize_ledger_entries(id) on delete restrict;

-- A prize has one credit and each credit can be reversed only once. The
-- historical credit itself remains immutable and visible to audit tooling.
create unique index prize_ledger_one_credit_per_winner_idx
  on public.prize_ledger_entries (provisional_winner_id)
  where entry_type = 'credit';
create unique index prize_ledger_one_reversal_per_credit_idx
  on public.prize_ledger_entries (reverses_ledger_entry_id)
  where reverses_ledger_entry_id is not null;

create table public.payout_credit_allocations (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.payouts(id) on delete restrict,
  credit_ledger_entry_id uuid not null references public.prize_ledger_entries(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'held' check (status in ('held', 'released', 'settled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payout_id, credit_ledger_entry_id)
);

create unique index payout_credit_allocations_one_active_hold_idx
  on public.payout_credit_allocations (credit_ledger_entry_id)
  where status = 'held';
create index payout_credit_allocations_payout_idx
  on public.payout_credit_allocations (payout_id, status);

create index payouts_player_status_idx on public.payouts (player_id, status, requested_at desc);
create unique index payouts_active_player_idx
  on public.payouts (player_id)
  where status in ('requested', 'under_review', 'approved');

create table private.admin_users (
  user_id uuid primary key references auth.users(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.player_eligibility_records (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete restrict,
  game_id uuid references public.games(id) on delete restrict,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  terms_version text,
  play_eligibility_status text not null default 'unknown'
    check (play_eligibility_status in ('unknown', 'eligible', 'restricted', 'ineligible')),
  prize_eligibility_status text not null default 'unknown'
    check (prize_eligibility_status in ('unknown', 'eligible', 'restricted', 'ineligible')),
  adult_representation_status text not null default 'unknown'
    check (adult_representation_status in ('unknown', 'confirmed', 'required', 'not_confirmed')),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (player_id, game_id)
);

-- Derive one validated run directly from a finalized authoritative session.
-- Client-supplied score, time, distance, game id, multiplier, and timestamps
-- are overwritten from the server-owned session.
create function private.materialize_validated_run()
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
  new.status_updated_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create function private.protect_validated_run_update()
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

create trigger validated_runs_materialize
  before insert on public.validated_runs
  for each row execute function private.materialize_validated_run();

create trigger validated_runs_protect_update
  before update on public.validated_runs
  for each row execute function private.protect_validated_run_update();

-- A finalized, replay-validated game session is the sole source for an
-- authoritative run. The client never inserts a score-bearing row.
create function private.create_validated_run_from_finalized_session()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_week_start date;
begin
  if old.status is distinct from 'finalized' and new.status = 'finalized' then
    -- Lock before creating the run, not merely while rebuilding rankings. A
    -- second finalization for this game/week waits here, then rebuilds from a
    -- committed, complete set of validated runs rather than a stale snapshot.
    v_game_id := new.game_id;
    v_week_start := private.ny_tournament_week_start(
      new.started_at + (new.final_elapsed_ms * interval '1 millisecond')
    );
    perform pg_advisory_xact_lock(
      hashtextextended('rtw:competition:week:' || v_game_id::text || ':' || v_week_start::text, 0)
    );
    insert into public.validated_runs (game_session_id)
    values (new.id)
    on conflict (game_session_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger game_sessions_materialize_validated_run
  after update of status on public.game_sessions
  for each row execute function private.create_validated_run_from_finalized_session();

-- Releasing an unpaid hold is an append-only accounting operation. It is used
-- before reversing a disqualified credit so an invalid prize cannot remain
-- locked in (or be paid by) a previously requested aggregate payout.
create function private.release_unsettled_payout_holds(
  p_player_id uuid,
  p_credit_ledger_entry_id uuid,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_payout public.payouts%rowtype;
begin
  for v_payout in
    select payout.*
    from public.payouts as payout
    where payout.player_id = p_player_id
      and payout.status <> 'paid'
      and exists (
        select 1 from public.prize_ledger_entries as hold
        where hold.payout_id = payout.id and hold.entry_type = 'payout_hold'
      )
      and exists (
        select 1 from public.payout_credit_allocations as allocation
        where allocation.payout_id = payout.id
          and allocation.credit_ledger_entry_id = p_credit_ledger_entry_id
          and allocation.status = 'held'
      )
      and not exists (
        select 1 from public.prize_ledger_entries as settled
        where settled.payout_id = payout.id
          and settled.entry_type in ('payout_release', 'payout_settlement')
      )
    order by payout.requested_at, payout.id
    for update
  loop
    if exists (
      select 1 from public.prize_ledger_entries as hold
      where hold.payout_id = v_payout.id and hold.entry_type = 'payout_hold'
    ) then
      update public.payout_credit_allocations
      set status = 'released', updated_at = now()
      where payout_id = v_payout.id and status = 'held';

      update public.payouts
      set status = case
            when status in ('requested', 'under_review', 'approved') then 'cancelled'
            else status
          end,
          updated_at = now()
      where id = v_payout.id;

      insert into public.prize_ledger_entries (
        player_id, game_id, payout_id, entry_type, amount_cents, reason, created_by_user_id
      )
      select
        p_player_id,
        hold.game_id,
        v_payout.id,
        'payout_release',
        -sum(hold.amount_cents)::integer,
        'Unpaid payout hold released for a competition correction',
        p_actor_user_id
      from public.prize_ledger_entries as hold
      where hold.payout_id = v_payout.id and hold.entry_type = 'payout_hold'
      group by hold.game_id;
    end if;
  end loop;
end;
$$;

create function private.flag_paid_winner_for_review(
  p_winner public.provisional_winners,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.fraud_flags (
    player_id, game_id, subject_type, subject_id, severity, status, signal_summary, created_by_user_id
  )
  select
    p_winner.player_id,
    p_winner.game_id,
    'provisional_winner',
    p_winner.id,
    'high',
    'under_review',
    'A paid prize may be affected by a later competition correction.',
    p_actor_user_id
  where not exists (
    select 1 from public.fraud_flags as flag
    where flag.subject_type = 'provisional_winner'
      and flag.subject_id = p_winner.id
      and flag.status in ('open', 'under_review', 'confirmed')
  );
end;
$$;

-- Returns false only when the credit is already represented in a paid payout.
-- Credits and reversals remain immutable facts; only a compensating entry is
-- appended, after any unpaid aggregate hold has been released.
create function private.reverse_provisional_winner_credit(
  p_winner_id uuid,
  p_actor_user_id uuid default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_winner public.provisional_winners%rowtype;
  v_credit public.prize_ledger_entries%rowtype;
begin
  select * into v_winner
  from public.provisional_winners
  where id = p_winner_id
  for update;
  if not found then raise exception 'Winner record unavailable.' using errcode = 'P0002'; end if;

  -- Every ledger allocation or correction for a player obtains this lock
  -- before locking credit rows. It gives claims and reversals one lock order.
  perform pg_advisory_xact_lock(hashtextextended('rtw:player-finance:' || v_winner.player_id::text, 0));

  select * into v_credit
  from public.prize_ledger_entries
  where provisional_winner_id = p_winner_id and entry_type = 'credit'
  for update;
  if not found then return true; end if;

  if exists (
    select 1 from public.prize_ledger_entries
    where reverses_ledger_entry_id = v_credit.id
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.payout_credit_allocations as allocation
    join public.payouts as payout on payout.id = allocation.payout_id
    where allocation.credit_ledger_entry_id = v_credit.id
      and payout.status = 'paid'
  ) then
    perform private.flag_paid_winner_for_review(v_winner, p_actor_user_id);
    return false;
  end if;

  -- Lock order matches balance-claim creation: player balance first, then
  -- payout rows. This prevents a claim from racing a correction.
  perform 1
  from public.prize_balances
  where player_id = v_winner.player_id
  for update;
  perform private.release_unsettled_payout_holds(v_winner.player_id, v_credit.id, p_actor_user_id);

  insert into public.prize_ledger_entries (
    player_id, game_id, provisional_winner_id, reverses_ledger_entry_id,
    entry_type, amount_cents, reason, created_by_user_id
  )
  values (
    v_winner.player_id,
    v_winner.game_id,
    v_winner.id,
    v_credit.id,
    'credit_reversal',
    -v_credit.amount_cents,
    'Competition correction reversed an unpaid approved prize',
    p_actor_user_id
  );
  return true;
end;
$$;

-- Reconcile server-derived rankings with any previously generated awards.
-- Paid payouts are not rewritten; they are preserved and escalated for review.
create function private.reconcile_stale_competition_winners(
  p_game_id uuid,
  p_week_start date,
  p_award_type text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_winner public.provisional_winners%rowtype;
  v_still_eligible boolean;
begin
  if p_award_type not in ('weekly_tournament', 'weekly_shares') then
    raise exception 'Unsupported award type.' using errcode = '22023';
  end if;

  for v_winner in
    select *
    from public.provisional_winners
    where game_id = p_game_id
      and tournament_week_start = p_week_start
      and award_type = p_award_type
      and status not in ('disqualified', 'expired')
    for update
  loop
    if p_award_type = 'weekly_tournament' then
      select exists (
        select 1 from public.weekly_tournament_totals as total
        where total.game_id = v_winner.game_id
          and total.tournament_week_start = v_winner.tournament_week_start
          and total.player_id = v_winner.player_id
          and total.rank_position = v_winner.rank_position
          and total.rank_position between 1 and 3
          and total.tie_break_status = 'resolved'
      ) into v_still_eligible;
    else
      select exists (
        select 1 from public.weekly_share_results as share
        where share.game_id = v_winner.game_id
          and share.tournament_week_start = v_winner.tournament_week_start
          and share.player_id = v_winner.player_id
          and share.is_winner
      ) into v_still_eligible;
    end if;

    if not v_still_eligible then
      if v_winner.status = 'paid' then
        perform private.flag_paid_winner_for_review(v_winner);
      elsif v_winner.status = 'approved_for_payment' then
        if private.reverse_provisional_winner_credit(v_winner.id) then
          update public.provisional_winners
          set status = 'disqualified',
              admin_note = coalesce(admin_note, 'Competition correction invalidated this approved award.')
          where id = v_winner.id;
        end if;
      elsif v_winner.status = 'verified' then
        update public.provisional_winners
        set status = 'disqualified',
            admin_note = coalesce(admin_note, 'Competition correction invalidated this verified award.')
        where id = v_winner.id;
      elsif v_winner.status in ('provisional', 'claim_started') then
        update public.provisional_winners
        set status = 'under_review',
            admin_note = coalesce(admin_note, 'Competition correction requires award review.')
        where id = v_winner.id;
      end if;
    end if;
  end loop;
end;
$$;

-- Materialize the Top 7 daily rows and weekly total/ranking from valid runs.
-- Array ordering is PostgreSQL lexicographic, which implements the required
-- best-score, second-best-score, and so on tie break exactly.
create function private.refresh_competition_week(p_game_id uuid, p_week_start date)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- Serialize recalculation of a single game/week. Concurrent finalized runs
  -- must not interleave delete/rebuild cycles and leave a partial Top 7.
  perform pg_advisory_xact_lock(
    hashtextextended('rtw:competition:week:' || p_game_id::text || ':' || p_week_start::text, 0)
  );
  delete from public.daily_top_scores
  where game_id = p_game_id and tournament_week_start = p_week_start;

  insert into public.daily_top_scores (
    game_id, player_id, tournament_day, tournament_week_start, daily_rank, validated_run_id, score
  )
  select
    ranked.game_id,
    ranked.player_id,
    ranked.tournament_day,
    ranked.tournament_week_start,
    ranked.daily_rank,
    ranked.id,
    ranked.score
  from (
    select
      run.id,
      run.game_id,
      run.player_id,
      run.tournament_day,
      run.tournament_week_start,
      run.score,
      row_number() over (
        partition by run.game_id, run.player_id, run.tournament_day
        order by run.score desc, run.completed_at asc, run.id asc
      )::smallint as daily_rank
    from public.validated_runs as run
    where run.game_id = p_game_id
      and run.tournament_week_start = p_week_start
      and run.eligibility_status = 'valid'
  ) as ranked
  where ranked.daily_rank <= 7;

  delete from public.weekly_tournament_totals
  where game_id = p_game_id and tournament_week_start = p_week_start;

  insert into public.weekly_tournament_totals (
    game_id, player_id, tournament_week_start, weekly_total_score, individual_scores, rank_position, tie_break_status
  )
  select
    daily.game_id,
    daily.player_id,
    p_week_start,
    sum(daily.score)::bigint,
    scores.individual_scores,
    1,
    'resolved'
  from public.daily_top_scores as daily
  join (
    select
      run.game_id,
      run.player_id,
      array_agg(run.score order by run.score desc, run.completed_at asc, run.id asc) as individual_scores
    from public.validated_runs as run
    where run.game_id = p_game_id
      and run.tournament_week_start = p_week_start
      and run.eligibility_status = 'valid'
    group by run.game_id, run.player_id
  ) as scores
    on scores.game_id = daily.game_id and scores.player_id = daily.player_id
  where daily.game_id = p_game_id
    and daily.tournament_week_start = p_week_start
  group by daily.game_id, daily.player_id, scores.individual_scores;

  with ordered as (
    select
      total.id,
      row_number() over (
        order by total.weekly_total_score desc, total.individual_scores desc, total.player_id asc
      ) as computed_rank,
      count(*) over (
        partition by total.weekly_total_score, total.individual_scores
      ) as exact_tie_count
    from public.weekly_tournament_totals as total
    where total.game_id = p_game_id
      and total.tournament_week_start = p_week_start
  )
  update public.weekly_tournament_totals as total
  set
    rank_position = ordered.computed_rank,
    tie_break_status = case when ordered.exact_tie_count > 1 then 'exact_tie' else 'resolved' end,
    calculated_at = now()
  from ordered
  where total.id = ordered.id;

  perform private.reconcile_stale_competition_winners(p_game_id, p_week_start, 'weekly_tournament');
end;
$$;

create function private.refresh_weekly_share_results(p_game_id uuid, p_week_start date)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_game_id::text || ':shares:' || p_week_start::text, 0));
  delete from public.weekly_share_results
  where game_id = p_game_id and tournament_week_start = p_week_start;

  insert into public.weekly_share_results (
    game_id, tournament_week_start, player_id, confirmed_share_count, rank_position, is_winner
  )
  select
    counted.game_id,
    p_week_start,
    counted.inviter_user_id,
    counted.confirmed_share_count,
    rank() over (order by counted.confirmed_share_count desc),
    counted.confirmed_share_count = max(counted.confirmed_share_count) over ()
  from (
    select
      referral.game_id,
      referral.inviter_user_id,
      count(*)::integer as confirmed_share_count
    from public.referrals as referral
    where referral.game_id = p_game_id
      and referral.status = 'valid'
      and referral.confirmed_tournament_week_start = p_week_start
    group by referral.game_id, referral.inviter_user_id
  ) as counted;

  perform private.reconcile_stale_competition_winners(p_game_id, p_week_start, 'weekly_shares');
end;
$$;

create function private.refresh_referral_qualification(p_invitee_user_id uuid)
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
        and run.completed_at >= v_referral.attached_at
        and run.tournament_day = qualification.qualification_day
      group by run.tournament_day
      having count(*) >= 3
    );

  select count(*), max(qualification_day)
  into v_qualified_day_count, v_completion_day
  from public.referral_qualification_days
  where referral_id = v_referral.id and status = 'valid';

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
    -- A later run disqualification must immediately remove this Share from
    -- rankings. It is preserved for human review rather than deleted.
    update public.referrals
    set status = 'under_review', updated_at = now()
    where id = v_referral.id;
  end if;
end;
$$;

create function private.after_validated_run_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_week_start date;
  v_player_id uuid;
begin
  if tg_op = 'DELETE' then
    v_game_id := old.game_id;
    v_week_start := old.tournament_week_start;
    v_player_id := old.player_id;
  else
    v_game_id := new.game_id;
    v_week_start := new.tournament_week_start;
    v_player_id := new.player_id;
  end if;
  perform private.refresh_competition_week(v_game_id, v_week_start);
  perform private.refresh_referral_qualification(v_player_id);
  return null;
end;
$$;

create trigger validated_runs_refresh_competition
  after insert or update of eligibility_status or delete on public.validated_runs
  for each row execute function private.after_validated_run_change();

create function private.prevent_referral_relationship_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.game_id is distinct from old.game_id
    or new.referral_code_id is distinct from old.referral_code_id
    or new.inviter_user_id is distinct from old.inviter_user_id
    or new.invitee_user_id is distinct from old.invitee_user_id
    or new.attached_at is distinct from old.attached_at
    or new.created_at is distinct from old.created_at then
    raise exception 'Referral ownership is immutable.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- The eligibility cutoff is server time, even for a future trusted internal
-- writer. No supplied referral timestamp can backdate qualifying activity.
create function private.materialize_referral_attachment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.attached_at := now();
  return new;
end;
$$;

create function private.after_referral_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Qualification is recalculated immediately, but its query uses the
    -- immutable attached_at cutoff and therefore cannot credit older runs.
    perform private.refresh_referral_qualification(new.invitee_user_id);
  end if;
  if tg_op = 'UPDATE' and old.confirmed_tournament_week_start is not null then
    perform private.refresh_weekly_share_results(old.game_id, old.confirmed_tournament_week_start);
  end if;
  if new.confirmed_tournament_week_start is not null then
    perform private.refresh_weekly_share_results(new.game_id, new.confirmed_tournament_week_start);
  end if;
  return null;
end;
$$;

create trigger referrals_protect_relationship
  before update on public.referrals
  for each row execute function private.prevent_referral_relationship_change();

create trigger referrals_materialize_attachment
  before insert on public.referrals
  for each row execute function private.materialize_referral_attachment();

create trigger referrals_refresh_share_results
  after insert or update of status, confirmed_tournament_week_start on public.referrals
  for each row execute function private.after_referral_change();

create function private.apply_prize_ledger_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('app.rtw_ledger_write', 'on', true);
  insert into public.prize_balances (player_id, available_cents, updated_at)
  values (new.player_id, new.amount_cents, now())
  on conflict (player_id) do update
    set available_cents = public.prize_balances.available_cents + excluded.available_cents,
        updated_at = now();
  return new;
end;
$$;

create function private.guard_prize_balance_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.rtw_ledger_write', true) <> 'on' then
    raise exception 'Prize balances are maintained only by the ledger.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function private.prevent_prize_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Prize ledger entries are append-only.' using errcode = '42501';
end;
$$;

create trigger prize_ledger_apply_balance
  after insert on public.prize_ledger_entries
  for each row execute function private.apply_prize_ledger_entry();

create trigger prize_balances_guard_write
  before insert or update or delete on public.prize_balances
  for each row execute function private.guard_prize_balance_write();

create trigger prize_ledger_prevent_mutation
  before update or delete on public.prize_ledger_entries
  for each row execute function private.prevent_prize_ledger_mutation();

create function private.protect_provisional_winner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.game_id is distinct from old.game_id
    or new.player_id is distinct from old.player_id
    or new.tournament_week_start is distinct from old.tournament_week_start
    or new.award_type is distinct from old.award_type
    or new.rank_position is distinct from old.rank_position
    or new.amount_cents is distinct from old.amount_cents
    or new.allocation_status is distinct from old.allocation_status
    or new.claim_deadline_at is distinct from old.claim_deadline_at
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

  if new.status = 'claim_started' and new.claim_started_at is null then new.claim_started_at := now(); end if;
  if new.status in ('verified', 'disqualified') and new.reviewed_at is null then new.reviewed_at := now(); end if;
  if new.status = 'approved_for_payment' and new.approved_at is null then new.approved_at := now(); end if;
  if new.status = 'paid' and new.paid_at is null then new.paid_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger provisional_winners_protect_state
  before update on public.provisional_winners
  for each row execute function private.protect_provisional_winner();

-- Server-only RPCs. They are in public only because the REST RPC gateway
-- exposes that schema; PUBLIC, anon, and authenticated receive no EXECUTE.
create function public.rtw_consume_competition_action_rate_limit(
  p_player_id uuid,
  p_action text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  case p_action
    when 'referral_attach' then v_limit := 6;
    when 'prize_claim' then v_limit := 6;
    when 'balance_claim' then v_limit := 4;
    else raise exception 'Unsupported competition action.' using errcode = '22023';
  end case;

  insert into private.competition_action_rate_limits as rate_limit (
    player_id, action, window_started_at, request_count, updated_at
  )
  values (p_player_id, p_action, v_window, 1, now())
  on conflict (player_id, action) do update
    set window_started_at = case
          when rate_limit.window_started_at = v_window then rate_limit.window_started_at
          else v_window
        end,
        request_count = case
          when rate_limit.window_started_at = v_window then rate_limit.request_count + 1
          else 1
        end,
        updated_at = now()
  returning request_count into v_count;

  return v_count <= v_limit;
end;
$$;

create function public.rtw_start_official_game_session(
  p_player_id uuid,
  p_game_slug text,
  p_gameplay_version text,
  p_seed bigint
)
returns table (
  id uuid,
  gameplay_version text,
  seed bigint,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_now timestamptz := now();
  v_starts_in_last_minute integer;
begin
  select game.id into v_game_id
  from public.games as game
  where game.slug = p_game_slug and game.status = 'active'
  for key share;
  if not found then raise exception 'Game is unavailable.' using errcode = '22023'; end if;

  -- A player obtains one deterministic lock. The count and insert below are
  -- in the same transaction, so concurrent server instances cannot exceed 8
  -- starts in a rolling server-time minute.
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
    id, user_id, game_id, gameplay_version, seed, started_at, expires_at
  )
  values (
    gen_random_uuid(), p_player_id, v_game_id, p_gameplay_version, p_seed,
    v_now, v_now + interval '10 minutes'
  )
  returning session.id, session.gameplay_version, session.seed, session.expires_at;
end;
$$;

create function public.rtw_ensure_referral_code(p_player_id uuid, p_game_slug text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_existing_code text;
  v_new_code text;
  v_attempt integer;
begin
  select id into v_game_id from public.games where slug = p_game_slug and status = 'active';
  if not found then raise exception 'Game is unavailable.' using errcode = '22023'; end if;
  if not exists (
    select 1 from auth.users where id = p_player_id and email_confirmed_at is not null
  ) then
    raise exception 'A verified email is required.' using errcode = '42501';
  end if;

  select code into v_existing_code
  from public.referral_codes
  where owner_user_id = p_player_id and game_id = v_game_id and revoked_at is null;
  if found then return v_existing_code; end if;

  for v_attempt in 1..5 loop
    v_new_code := upper(replace(gen_random_uuid()::text, '-', ''));
    begin
      insert into public.referral_codes (owner_user_id, game_id, code)
      values (p_player_id, v_game_id, v_new_code)
      on conflict (owner_user_id, game_id) do nothing
      returning code into v_existing_code;
      if v_existing_code is not null then return v_existing_code; end if;

      select code into v_existing_code
      from public.referral_codes
      where owner_user_id = p_player_id and game_id = v_game_id and revoked_at is null;
      if found then return v_existing_code; end if;
    exception when unique_violation then
      -- A generated code collision is retried; no user-controlled code exists.
      null;
    end;
  end loop;
  raise exception 'Could not allocate referral code.' using errcode = 'P0001';
end;
$$;

create function public.rtw_attach_referral(p_invitee_user_id uuid, p_game_slug text, p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_code_id uuid;
  v_inviter_user_id uuid;
  v_existing public.referrals%rowtype;
  v_referral_id uuid;
begin
  if p_code is null or upper(trim(p_code)) !~ '^[A-Z0-9]{10,32}$' then
    raise exception 'Invalid referral code.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.users
    where id = p_invitee_user_id and email_confirmed_at is not null
  ) then
    raise exception 'A verified email is required.' using errcode = '42501';
  end if;

  select id into v_game_id from public.games where slug = p_game_slug and status = 'active';
  if not found then raise exception 'Game is unavailable.' using errcode = '22023'; end if;

  -- Referrer ownership is global across games, so every graph mutation takes
  -- one shared transaction-scoped lock before inspecting edges. This
  -- serializes A->B versus B->A (including cross-game edges) and longer
  -- cycles. It cannot deadlock because this function acquires exactly one
  -- deterministic graph key.
  perform pg_advisory_xact_lock(hashtextextended('rtw:referral-graph', 0));

  select code.id, code.owner_user_id
  into v_code_id, v_inviter_user_id
  from public.referral_codes as code
  where code.game_id = v_game_id
    and code.code = upper(trim(p_code))
    and code.revoked_at is null
  for update;
  if not found then raise exception 'Referral code is unavailable.' using errcode = '22023'; end if;
  if v_inviter_user_id = p_invitee_user_id then
    raise exception 'Self referral is not permitted.' using errcode = '23514';
  end if;

  select * into v_existing
  from public.referrals
  where invitee_user_id = p_invitee_user_id
  for update;
  if found then
    if v_existing.inviter_user_id = v_inviter_user_id and v_existing.game_id = v_game_id then
      return v_existing.id;
    end if;
    raise exception 'Referral ownership is already established.' using errcode = '23505';
  end if;

  if exists (
    with recursive ancestors(user_id) as (
      select v_inviter_user_id
      union
      select referral.inviter_user_id
      from public.referrals as referral
      join ancestors on referral.invitee_user_id = ancestors.user_id
    )
    select 1 from ancestors where user_id = p_invitee_user_id
  ) then
    raise exception 'Referral cycle is not permitted.' using errcode = '23514';
  end if;

  insert into public.referrals (game_id, referral_code_id, inviter_user_id, invitee_user_id)
  values (v_game_id, v_code_id, v_inviter_user_id, p_invitee_user_id)
  returning id into v_referral_id;
  return v_referral_id;
end;
$$;

create function public.rtw_begin_prize_claim(p_player_id uuid, p_winner_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_winner public.provisional_winners%rowtype;
begin
  select * into v_winner
  from public.provisional_winners
  where id = p_winner_id and player_id = p_player_id
  for update;
  if not found then return false; end if;
  -- Repeated browser requests for the same already-started claim are safe and
  -- canonical: no additional state transition, award, or payout is created.
  if v_winner.status = 'claim_started' then return true; end if;
  if v_winner.status <> 'provisional'
    or v_winner.allocation_status <> 'allocated'
    or v_winner.amount_cents is null
    or now() > v_winner.claim_deadline_at then
    return false;
  end if;
  if exists (
    select 1
    from public.player_eligibility_records as eligibility
    where eligibility.player_id = p_player_id
      and (eligibility.game_id is null or eligibility.game_id = v_winner.game_id)
      and eligibility.prize_eligibility_status in ('restricted', 'ineligible')
  ) then
    return false;
  end if;
  update public.provisional_winners
  set status = 'claim_started'
  where id = v_winner.id;
  return true;
end;
$$;

create function public.rtw_admin_transition_winner(
  p_actor_user_id uuid,
  p_winner_id uuid,
  p_new_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_winner public.provisional_winners%rowtype;
begin
  if not exists (
    select 1 from private.admin_users
    where user_id = p_actor_user_id and is_active
  ) then
    raise exception 'Administrator authorization is required.' using errcode = '42501';
  end if;

  select * into v_winner
  from public.provisional_winners
  where id = p_winner_id
  for update;
  if not found then raise exception 'Winner record unavailable.' using errcode = 'P0002'; end if;

  if p_new_status = 'disqualified' and v_winner.status = 'paid' then
    -- A paid award is immutable financial history. Preserve it and create a
    -- review signal instead of rewriting a past payment or its ledger trail.
    perform private.flag_paid_winner_for_review(v_winner, p_actor_user_id);
    return;
  end if;
  if p_new_status = 'disqualified' and v_winner.status = 'approved_for_payment' then
    if not private.reverse_provisional_winner_credit(v_winner.id, p_actor_user_id) then
      return;
    end if;
  end if;

  update public.provisional_winners
  set status = p_new_status,
      admin_note = coalesce(p_note, admin_note)
  where id = p_winner_id
  returning * into v_winner;
  if not found then raise exception 'Winner record unavailable.' using errcode = 'P0002'; end if;

  if p_new_status = 'approved_for_payment' then
    if v_winner.allocation_status <> 'allocated' or v_winner.amount_cents is null then
      raise exception 'Winner allocation must be finalized before approval.' using errcode = '23514';
    end if;
    insert into public.prize_ledger_entries (
      player_id, game_id, provisional_winner_id, entry_type, amount_cents, reason, created_by_user_id
    )
    values (
      v_winner.player_id,
      v_winner.game_id,
      v_winner.id,
      'credit',
      v_winner.amount_cents,
      'Approved provisional prize',
      p_actor_user_id
    )
    on conflict (provisional_winner_id) where entry_type = 'credit' do nothing;
  end if;
end;
$$;

-- Fraud decisions are server-only and leave evidence in place. Changing a run
-- or referral status fires the recalculation triggers above instead of
-- deleting historical rows or trusting a client-side ranking.
create function public.rtw_admin_set_validated_run_eligibility(
  p_actor_user_id uuid,
  p_validated_run_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.validated_runs%rowtype;
begin
  if not exists (select 1 from private.admin_users where user_id = p_actor_user_id and is_active) then
    raise exception 'Administrator authorization is required.' using errcode = '42501';
  end if;
  if p_status not in ('valid', 'flagged', 'under_review', 'disqualified', 'fraud_confirmed') then
    raise exception 'Invalid run review status.' using errcode = '22023';
  end if;

  update public.validated_runs
  set eligibility_status = p_status
  where id = p_validated_run_id
  returning * into v_run;
  if not found then raise exception 'Validated run unavailable.' using errcode = 'P0002'; end if;

  if p_status <> 'valid' then
    insert into public.fraud_flags (
      player_id, game_id, subject_type, subject_id, severity, status, signal_summary, created_by_user_id
    ) values (
      v_run.player_id, v_run.game_id, 'validated_run', v_run.id, 'medium',
      case when p_status in ('fraud_confirmed', 'disqualified') then 'confirmed' else 'under_review' end,
      coalesce(nullif(left(trim(p_note), 500), ''), 'Administrative eligibility review'), p_actor_user_id
    );
  end if;
end;
$$;

create function public.rtw_admin_set_referral_status(
  p_actor_user_id uuid,
  p_referral_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referral public.referrals%rowtype;
begin
  if not exists (select 1 from private.admin_users where user_id = p_actor_user_id and is_active) then
    raise exception 'Administrator authorization is required.' using errcode = '42501';
  end if;
  if p_status not in ('invite_pending', 'valid', 'flagged', 'under_review', 'disqualified', 'fraud_confirmed') then
    raise exception 'Invalid referral review status.' using errcode = '22023';
  end if;
  if p_status = 'invite_pending' then
    raise exception 'Referral qualification cannot be reset.' using errcode = '23514';
  end if;

  update public.referrals
  set status = p_status
  where id = p_referral_id
  returning * into v_referral;
  if not found then raise exception 'Referral unavailable.' using errcode = 'P0002'; end if;

  if p_status <> 'valid' then
    insert into public.fraud_flags (
      player_id, game_id, subject_type, subject_id, severity, status, signal_summary, created_by_user_id
    ) values (
      v_referral.invitee_user_id, v_referral.game_id, 'referral', v_referral.id, 'medium',
      case when p_status in ('fraud_confirmed', 'disqualified') then 'confirmed' else 'under_review' end,
      coalesce(nullif(left(trim(p_note), 500), ''), 'Administrative referral review'), p_actor_user_id
    );
  end if;
end;
$$;

create function public.rtw_begin_balance_payout_request(p_player_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_eligible_cents bigint := 0;
  v_payout_id uuid;
  v_existing_payout_id uuid;
  v_credit record;
begin
  -- This serializes idempotent balance claims independently of the web tier
  -- and matches the correction path's lock order before credit-row locks.
  perform pg_advisory_xact_lock(hashtextextended('rtw:player-finance:' || p_player_id::text, 0));

  select available_cents into v_balance
  from public.prize_balances
  where player_id = p_player_id
  for update;
  if not found then
    raise exception 'Eligible prize balance is unavailable.' using errcode = '22023';
  end if;

  -- Repeated requests return the canonical active request. A duplicate click
  -- can therefore never create a second hold or payout.
  select id into v_existing_payout_id
  from public.payouts
  where player_id = p_player_id and status in ('requested', 'under_review', 'approved')
  for update;
  if found then return v_existing_payout_id; end if;

  -- Match the direct-prize eligibility rule at the database boundary; the
  -- browser cannot turn an aggregate ledger balance into a payable claim.
  if exists (
    select 1
    from public.player_eligibility_records as eligibility
    where eligibility.player_id = p_player_id
      and eligibility.prize_eligibility_status in ('restricted', 'ineligible')
  ) then
    raise exception 'Eligible prize balance is unavailable.' using errcode = '42501';
  end if;

  -- Only unallocated credits from approved, allocated provisional winners are
  -- payable. Manual adjustments, pending prizes, reversed credits, and any
  -- already-held credit are excluded even if they appear in the raw balance.
  for v_credit in
    select credit.id, credit.amount_cents
    from public.prize_ledger_entries as credit
    join public.provisional_winners as winner on winner.id = credit.provisional_winner_id
    where credit.player_id = p_player_id
      and credit.entry_type = 'credit'
      and winner.player_id = p_player_id
      and winner.status = 'approved_for_payment'
      and winner.allocation_status = 'allocated'
      and not exists (
        select 1 from public.prize_ledger_entries as reversal
        where reversal.reverses_ledger_entry_id = credit.id
      )
      and not exists (
        select 1 from public.payout_credit_allocations as allocation
        where allocation.credit_ledger_entry_id = credit.id
          and allocation.status in ('held', 'settled')
      )
    order by credit.created_at, credit.id
    for update of credit
  loop
    v_eligible_cents := v_eligible_cents + v_credit.amount_cents;
  end loop;

  if v_eligible_cents < 1000
    or v_balance < v_eligible_cents
    or v_eligible_cents > 2147483647 then
    raise exception 'Eligible prize balance is unavailable.' using errcode = '22023';
  end if;

  insert into public.payouts (player_id, amount_cents, status)
  values (p_player_id, v_eligible_cents::integer, 'requested')
  returning id into v_payout_id;

  insert into public.payout_credit_allocations (
    payout_id, credit_ledger_entry_id, amount_cents
  )
  select
    v_payout_id,
    credit.id,
    credit.amount_cents
  from public.prize_ledger_entries as credit
  join public.provisional_winners as winner on winner.id = credit.provisional_winner_id
  where credit.player_id = p_player_id
    and credit.entry_type = 'credit'
    and winner.player_id = p_player_id
    and winner.status = 'approved_for_payment'
    and winner.allocation_status = 'allocated'
    and not exists (
      select 1 from public.prize_ledger_entries as reversal
      where reversal.reverses_ledger_entry_id = credit.id
    )
    and not exists (
      select 1 from public.payout_credit_allocations as allocation
      where allocation.credit_ledger_entry_id = credit.id
        and allocation.status in ('held', 'settled')
    );

  insert into public.prize_ledger_entries (
    player_id, game_id, payout_id, entry_type, amount_cents, reason, created_by_user_id
  )
  select
    p_player_id,
    credit.game_id,
    v_payout_id,
    'payout_hold',
    -sum(allocation.amount_cents)::integer,
    'Player initiated eligible prize payout request',
    p_player_id
  from public.prize_ledger_entries as credit
  join public.payout_credit_allocations as allocation on allocation.credit_ledger_entry_id = credit.id
  where allocation.payout_id = v_payout_id
  group by credit.game_id;
  return v_payout_id;
end;
$$;

create function public.rtw_generate_provisional_winners(
  p_actor_user_id uuid,
  p_game_slug text,
  p_week_start date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_share_winner_count integer;
begin
  if not exists (
    select 1 from private.admin_users
    where user_id = p_actor_user_id and is_active
  ) then
    raise exception 'Administrator authorization is required.' using errcode = '42501';
  end if;
  if now() < ((p_week_start + 7)::timestamp at time zone 'America/New_York') then
    raise exception 'Weekly winners cannot be generated before the week closes.' using errcode = '22023';
  end if;
  select id into v_game_id from public.games where slug = p_game_slug;
  if not found then raise exception 'Game is unavailable.' using errcode = '22023'; end if;

  perform private.refresh_competition_week(v_game_id, p_week_start);
  perform private.refresh_weekly_share_results(v_game_id, p_week_start);

  insert into public.provisional_winners (
    game_id, player_id, tournament_week_start, award_type, rank_position,
    amount_cents, allocation_status, claim_deadline_at
  )
  select
    total.game_id,
    total.player_id,
    total.tournament_week_start,
    'weekly_tournament',
    total.rank_position,
    case total.rank_position when 1 then 1500 when 2 then 300 when 3 then 200 end,
    'allocated',
    ((p_week_start + 14)::timestamp at time zone 'America/New_York')
  from public.weekly_tournament_totals as total
  where total.game_id = v_game_id
    and total.tournament_week_start = p_week_start
    and total.rank_position between 1 and 3
    and total.tie_break_status = 'resolved'
    and not exists (
      select 1 from public.weekly_tournament_totals as earlier
      where earlier.game_id = total.game_id
        and earlier.tournament_week_start = total.tournament_week_start
        and earlier.rank_position < total.rank_position
        and earlier.tie_break_status = 'exact_tie'
    )
  on conflict (game_id, tournament_week_start, award_type, player_id) do nothing;

  select count(*) into v_share_winner_count
  from public.weekly_share_results
  where game_id = v_game_id
    and tournament_week_start = p_week_start
    and is_winner;

  if v_share_winner_count > 0 then
    insert into public.provisional_winners (
      game_id, player_id, tournament_week_start, award_type, rank_position,
      amount_cents, allocation_status, claim_deadline_at
    )
    select
      share.game_id,
      share.player_id,
      share.tournament_week_start,
      'weekly_shares',
      share.rank_position,
      -- The $10 pool is split to the cent. If cents cannot divide evenly,
      -- deterministic UUID order receives the one-cent remainders; no value
      -- is lost and no client can choose the allocation.
      (1000 / v_share_winner_count)
        + case when row_number() over (order by share.player_id) <= mod(1000, v_share_winner_count) then 1 else 0 end,
      'allocated',
      ((p_week_start + 14)::timestamp at time zone 'America/New_York')
    from public.weekly_share_results as share
    where share.game_id = v_game_id
      and share.tournament_week_start = p_week_start
      and share.is_winner
    on conflict (game_id, tournament_week_start, award_type, player_id) do nothing;
  end if;
end;
$$;

create function public.rtw_normal_ad_cadence(p_player_id uuid, p_game_slug text)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
begin
  select id into v_game_id from public.games where slug = p_game_slug and status = 'active';
  if not found then raise exception 'Game is unavailable.' using errcode = '22023'; end if;
  if exists (
    select 1 from public.referrals
    where invitee_user_id = p_player_id and game_id = v_game_id and status = 'invite_pending'
  ) then
    return 1;
  end if;
  return 2;
end;
$$;

revoke all on function private.materialize_validated_run() from public, anon, authenticated;
revoke all on function private.protect_validated_run_update() from public, anon, authenticated;
revoke all on function private.release_unsettled_payout_holds(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.flag_paid_winner_for_review(public.provisional_winners, uuid) from public, anon, authenticated;
revoke all on function private.reverse_provisional_winner_credit(uuid, uuid) from public, anon, authenticated;
revoke all on function private.reconcile_stale_competition_winners(uuid, date, text) from public, anon, authenticated;
revoke all on function private.refresh_competition_week(uuid, date) from public, anon, authenticated;
revoke all on function private.refresh_weekly_share_results(uuid, date) from public, anon, authenticated;
revoke all on function private.refresh_referral_qualification(uuid) from public, anon, authenticated;
revoke all on function private.after_validated_run_change() from public, anon, authenticated;
revoke all on function private.create_validated_run_from_finalized_session() from public, anon, authenticated;
revoke all on function private.prevent_referral_relationship_change() from public, anon, authenticated;
revoke all on function private.materialize_referral_attachment() from public, anon, authenticated;
revoke all on function private.after_referral_change() from public, anon, authenticated;
revoke all on function private.apply_prize_ledger_entry() from public, anon, authenticated;
revoke all on function private.guard_ad_reward_claim() from public, anon, authenticated;
revoke all on function private.guard_prize_balance_write() from public, anon, authenticated;
revoke all on function private.prevent_prize_ledger_mutation() from public, anon, authenticated;
revoke all on function private.protect_provisional_winner() from public, anon, authenticated;
revoke all on function public.rtw_consume_competition_action_rate_limit(uuid, text) from public, anon, authenticated;
revoke all on function public.rtw_start_official_game_session(uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function public.rtw_ensure_referral_code(uuid, text) from public, anon, authenticated;
revoke all on function public.rtw_attach_referral(uuid, text, text) from public, anon, authenticated;
revoke all on function public.rtw_begin_prize_claim(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rtw_admin_transition_winner(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.rtw_admin_set_validated_run_eligibility(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.rtw_admin_set_referral_status(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.rtw_begin_balance_payout_request(uuid) from public, anon, authenticated;
revoke all on function public.rtw_generate_provisional_winners(uuid, text, date) from public, anon, authenticated;
revoke all on function public.rtw_normal_ad_cadence(uuid, text) from public, anon, authenticated;
grant execute on function public.rtw_ensure_referral_code(uuid, text) to service_role;
grant execute on function public.rtw_consume_competition_action_rate_limit(uuid, text) to service_role;
grant execute on function public.rtw_start_official_game_session(uuid, text, text, bigint) to service_role;
grant execute on function public.rtw_attach_referral(uuid, text, text) to service_role;
grant execute on function public.rtw_begin_prize_claim(uuid, uuid) to service_role;
grant execute on function public.rtw_admin_transition_winner(uuid, uuid, text, text) to service_role;
grant execute on function public.rtw_admin_set_validated_run_eligibility(uuid, uuid, text, text) to service_role;
grant execute on function public.rtw_admin_set_referral_status(uuid, uuid, text, text) to service_role;
grant execute on function public.rtw_begin_balance_payout_request(uuid) to service_role;
grant execute on function public.rtw_generate_provisional_winners(uuid, text, date) to service_role;
grant execute on function public.rtw_normal_ad_cadence(uuid, text) to service_role;

-- No Data API access to private or competitive state. RLS is retained as
-- defense in depth should a future grant be made by mistake.
alter table public.games enable row level security;
alter table public.validated_runs enable row level security;
alter table public.daily_top_scores enable row level security;
alter table public.weekly_tournament_totals enable row level security;
alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
alter table public.referral_qualification_days enable row level security;
alter table public.weekly_share_results enable row level security;
alter table public.ad_reward_claims enable row level security;
alter table public.normal_ad_delivery_events enable row level security;
alter table public.fraud_flags enable row level security;
alter table public.fraud_reviews enable row level security;
alter table public.provisional_winners enable row level security;
alter table public.prize_ledger_entries enable row level security;
alter table public.prize_balances enable row level security;
alter table public.payouts enable row level security;
alter table public.payout_credit_allocations enable row level security;
alter table public.player_eligibility_records enable row level security;
alter table private.admin_users enable row level security;
alter table private.competition_action_rate_limits enable row level security;

revoke all on table public.games from public, anon, authenticated;
revoke all on table public.validated_runs from public, anon, authenticated;
revoke all on table public.daily_top_scores from public, anon, authenticated;
revoke all on table public.weekly_tournament_totals from public, anon, authenticated;
revoke all on table public.referral_codes from public, anon, authenticated;
revoke all on table public.referrals from public, anon, authenticated;
revoke all on table public.referral_qualification_days from public, anon, authenticated;
revoke all on table public.weekly_share_results from public, anon, authenticated;
revoke all on table public.ad_reward_claims from public, anon, authenticated;
revoke all on table public.normal_ad_delivery_events from public, anon, authenticated;
revoke all on table public.fraud_flags from public, anon, authenticated;
revoke all on table public.fraud_reviews from public, anon, authenticated;
revoke all on table public.provisional_winners from public, anon, authenticated;
revoke all on table public.prize_ledger_entries from public, anon, authenticated;
revoke all on table public.prize_balances from public, anon, authenticated;
revoke all on table public.payouts from public, anon, authenticated;
revoke all on table public.payout_credit_allocations from public, anon, authenticated;
revoke all on table public.player_eligibility_records from public, anon, authenticated;
revoke all on table private.admin_users from public, anon, authenticated;
revoke all on table private.competition_action_rate_limits from public, anon, authenticated;

-- The only runtime database principal with access is the server-side
-- service_role client. These grants are explicit so that a fresh project does
-- not rely on Supabase default privileges; they do not grant a browser role.
grant select, insert, update on table public.game_sessions to service_role;
grant select on table public.games to service_role;
grant select, insert, update on table public.validated_runs to service_role;
grant select on table public.daily_top_scores to service_role;
grant select on table public.weekly_tournament_totals to service_role;
grant select, insert, update on table public.referral_codes to service_role;
grant select, insert, update on table public.referrals to service_role;
grant select, insert, update on table public.referral_qualification_days to service_role;
grant select on table public.weekly_share_results to service_role;
grant select, insert, update on table public.ad_reward_claims to service_role;
grant select, insert, update on table public.normal_ad_delivery_events to service_role;
grant select, insert, update on table public.fraud_flags to service_role;
grant select, insert, update on table public.fraud_reviews to service_role;
grant select, insert, update on table public.provisional_winners to service_role;
grant select, insert on table public.prize_ledger_entries to service_role;
grant select on table public.prize_balances to service_role;
grant select, insert, update on table public.payouts to service_role;
grant select, insert, update on table public.payout_credit_allocations to service_role;
grant select, insert, update on table public.player_eligibility_records to service_role;
grant select, insert, update on table private.admin_users to service_role;
