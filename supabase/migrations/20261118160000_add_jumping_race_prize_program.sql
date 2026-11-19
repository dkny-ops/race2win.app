-- Jumping Race weekly prize program. This is intentionally dormant on install:
-- it creates no prizes, balance credits, payout records, or winner records.
-- Only the configured, confirmed owner can later activate it and manually
-- approve a frozen candidate for a shared-wallet credit.

insert into public.games (slug, display_name, status)
values ('jumping-race', 'Jumping Race', 'active')
on conflict (slug) do nothing;

create table if not exists private.jumping_race_prize_program (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  activated_at timestamptz,
  inaugural_week_start date,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (not enabled and activated_at is null and inaugural_week_start is null)
    or (enabled and activated_at is not null and inaugural_week_start is not null
        and extract(isodow from inaugural_week_start) = 1)
  )
);

create table if not exists private.jumping_race_prize_period_results (
  week date not null check (extract(isodow from week) = 1),
  player_id uuid not null references auth.users(id) on delete restrict,
  username text not null,
  weekly_total bigint not null check (weekly_total >= 0),
  scores integer[] not null,
  rank_position integer,
  review_required boolean not null,
  snapshot_at timestamptz not null default clock_timestamp(),
  primary key (week, player_id),
  check ((rank_position is null) = review_required)
);

create table if not exists private.jumping_race_prize_winner_cases (
  week date not null,
  player_id uuid not null,
  opening_rank integer not null check (opening_rank between 1 and 3),
  state text not null default 'pending_review'
    check (state in ('pending_review', 'needs_additional_review', 'approved', 'rejected')),
  review_actor uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (week, player_id),
  foreign key (week, player_id)
    references private.jumping_race_prize_period_results (week, player_id) on delete restrict,
  check (
    (state in ('pending_review', 'needs_additional_review')
      and review_actor is null and reviewed_at is null and review_note is null)
    or (state in ('approved', 'rejected')
      and review_actor is not null and reviewed_at is not null
      and length(review_note) between 1 and 500)
  )
);

create table if not exists private.jumping_race_prize_winner_case_events (
  id uuid primary key default gen_random_uuid(),
  week date not null,
  player_id uuid not null,
  actor uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved', 'rejected', 'needs_additional_review', 'financial_credit_approved')),
  note text not null check (length(note) between 1 and 500),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (week, player_id)
    references private.jumping_race_prize_winner_cases (week, player_id) on delete restrict
);

create index if not exists jumping_race_prize_cases_queue
  on private.jumping_race_prize_winner_cases (week, state, created_at);
create index if not exists jumping_race_prize_case_events_history
  on private.jumping_race_prize_winner_case_events (week, player_id, created_at);

alter table private.jumping_race_prize_program enable row level security;
alter table private.jumping_race_prize_period_results enable row level security;
alter table private.jumping_race_prize_winner_cases enable row level security;
alter table private.jumping_race_prize_winner_case_events enable row level security;
revoke all on table private.jumping_race_prize_program,
  private.jumping_race_prize_period_results,
  private.jumping_race_prize_winner_cases,
  private.jumping_race_prize_winner_case_events from public, anon, authenticated, service_role;

insert into private.jumping_race_prize_program (singleton)
values (true) on conflict (singleton) do nothing;

create or replace function private.jr_prize_standings(p_week date)
returns table(player_id uuid, username text, weekly_total bigint, scores integer[],
              rank_position integer, review_required boolean)
language sql stable security definer set search_path = '' as $$
  with program as (
    select activated_at from private.jumping_race_prize_program
    where singleton and enabled
  ), daily as (
    select r.player_id, r.score, r.finalized_at, r.session_id,
      row_number() over (
        partition by r.player_id, (r.finalized_at at time zone 'America/New_York')::date
        order by r.score desc, r.finalized_at asc, r.session_id
      ) as daily_rank
    from private.jumping_race_results r
    cross join program p
    where r.result_status = 'verified'
      and r.finalized_at >= p.activated_at
      and (r.finalized_at at time zone 'America/New_York')::date between p_week and p_week + 6
  ), vectors as (
    select player_id,
      sum(score) filter (where daily_rank <= 7)::bigint as total,
      array_agg(score order by score desc, finalized_at asc, session_id)
        filter (where daily_rank <= 7) as score_vector
    from daily group by player_id
  ), ranked as (
    select v.*, rank() over (order by v.total desc, v.score_vector desc) as position,
      count(*) over (partition by v.total, v.score_vector) > 1 as tied
    from vectors v
  )
  select r.player_id, p.username, r.total, r.score_vector,
    case when r.tied then null else r.position::integer end, r.tied
  from ranked r
  join public.profiles p on p.user_id = r.player_id
  where p.username is not null
$$;

create or replace function private.jr_prize_effective_candidates(p_week date)
returns table(player_id uuid, username text, weekly_total bigint, scores integer[],
              opening_rank integer, state text, effective_rank integer)
language sql stable security definer set search_path = '' as $$
  with eligible as (
    select r.player_id, r.username, r.weekly_total, r.scores, r.rank_position,
      coalesce(c.state, 'pending_review') as state
    from private.jumping_race_prize_period_results r
    left join private.jumping_race_prize_winner_cases c
      on c.week = r.week and c.player_id = r.player_id
    where r.week = p_week and r.rank_position is not null and not r.review_required
      and coalesce(c.state, 'pending_review') <> 'rejected'
  ), ranked as (
    select e.*, row_number() over (order by e.rank_position, e.player_id) as effective_rank
    from eligible e
  )
  select player_id, username, weekly_total, scores, rank_position, state, effective_rank::integer
  from ranked
$$;

create or replace function private.jr_open_prize_cases(p_week date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into private.jumping_race_prize_winner_cases (week, player_id, opening_rank)
  select p_week, c.player_id, c.effective_rank
  from private.jr_prize_effective_candidates(p_week) c
  where c.effective_rank <= 3
  on conflict (week, player_id) do nothing;
end;
$$;

create or replace function private.jr_is_confirmed_financial_owner(p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from private.admin_users a
    join auth.users u on u.id = a.user_id
    where a.user_id = p_actor and a.is_active
      and lower(u.email) = lower('racetowinapp@gmail.com')
      and u.email_confirmed_at is not null
  )
$$;

create or replace function public.jr_activate_prize_program(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p private.jumping_race_prize_program%rowtype;
begin
  if not private.jr_is_confirmed_financial_owner(p_actor) then
    raise exception 'Prize activation unavailable' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jumping-race:prize:program', 0));
  select * into p from private.jumping_race_prize_program where singleton for update;
  if p.enabled then
    return jsonb_build_object('enabled', true, 'activatedAt', p.activated_at,
      'inauguralWeekStart', p.inaugural_week_start, 'idempotent', true, 'paymentsEnabled', false);
  end if;
  update private.jumping_race_prize_program
  set enabled = true,
      activated_at = clock_timestamp(),
      inaugural_week_start = date_trunc('week', (clock_timestamp() at time zone 'America/New_York')::date)::date,
      updated_at = clock_timestamp()
  where singleton returning * into p;
  return jsonb_build_object('enabled', true, 'activatedAt', p.activated_at,
    'inauguralWeekStart', p.inaugural_week_start, 'idempotent', false, 'paymentsEnabled', false);
end;
$$;

create or replace function public.jr_close_prize_period(p_actor uuid, p_week date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p private.jumping_race_prize_program%rowtype;
        v_current_week date := date_trunc('week', (clock_timestamp() at time zone 'America/New_York')::date)::date;
begin
  if not private.jr_is_confirmed_financial_owner(p_actor)
     or p_week is null or extract(isodow from p_week) <> 1 or p_week >= v_current_week then
    raise exception 'Prize closure unavailable' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jumping-race:prize:week:' || p_week::text, 0));
  select * into p from private.jumping_race_prize_program where singleton and enabled for update;
  if not found or p_week < p.inaugural_week_start then
    raise exception 'Prize period unavailable' using errcode = 'P0001';
  end if;
  if exists (select 1 from private.jumping_race_prize_period_results where week = p_week) then
    return jsonb_build_object('week', p_week, 'idempotent', true, 'paymentsEnabled', false);
  end if;
  insert into private.jumping_race_prize_period_results
    (week, player_id, username, weekly_total, scores, rank_position, review_required)
  select p_week, s.player_id, s.username, s.weekly_total, s.scores, s.rank_position, s.review_required
  from private.jr_prize_standings(p_week) s;
  perform private.jr_open_prize_cases(p_week);
  return jsonb_build_object('week', p_week, 'idempotent', false, 'paymentsEnabled', false);
end;
$$;

create or replace function public.jr_decide_prize_candidate(
  p_actor uuid, p_week date, p_player uuid, p_decision text, p_note text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c private.jumping_race_prize_winner_cases%rowtype;
begin
  if not private.jr_is_confirmed_financial_owner(p_actor)
     or p_week is null or extract(isodow from p_week) <> 1 or p_player is null
     or p_decision not in ('approved', 'rejected', 'needs_additional_review')
     or p_note is null or length(btrim(p_note)) not between 1 and 500 then
    raise exception 'Prize review unavailable' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jumping-race:prize:week:' || p_week::text, 0));
  select * into c from private.jumping_race_prize_winner_cases
  where week = p_week and player_id = p_player for update;
  if not found then raise exception 'Candidate unavailable' using errcode = 'P0002'; end if;
  if c.state in ('approved', 'rejected') then
    if c.state = p_decision and c.review_actor = p_actor and c.review_note = btrim(p_note) then
      return jsonb_build_object('state', c.state, 'idempotent', true, 'paymentsEnabled', false);
    end if;
    raise exception 'Candidate already resolved' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from private.jr_prize_effective_candidates(p_week)
    where player_id = p_player and effective_rank <= 3
  ) then raise exception 'Candidate no longer current' using errcode = 'P0001'; end if;
  insert into private.jumping_race_prize_winner_case_events (week, player_id, actor, decision, note)
  values (p_week, p_player, p_actor, p_decision, btrim(p_note));
  update private.jumping_race_prize_winner_cases
  set state = p_decision,
      review_actor = case when p_decision = 'needs_additional_review' then null else p_actor end,
      reviewed_at = case when p_decision = 'needs_additional_review' then null else clock_timestamp() end,
      review_note = case when p_decision = 'needs_additional_review' then null else btrim(p_note) end,
      updated_at = clock_timestamp()
  where week = p_week and player_id = p_player;
  perform private.jr_open_prize_cases(p_week);
  return jsonb_build_object('state', p_decision, 'prizesEnabled', true, 'paymentsEnabled', false);
end;
$$;

create or replace function public.jr_admin_allocate_prize(
  p_actor uuid, p_week date, p_player uuid, p_note text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p private.jumping_race_prize_program%rowtype;
declare c record;
declare v_game uuid;
declare v_amount integer;
declare v_winner public.provisional_winners%rowtype;
begin
  if not private.jr_is_confirmed_financial_owner(p_actor)
     or p_week is null or extract(isodow from p_week) <> 1 or p_player is null
     or p_note is null or length(btrim(p_note)) not between 1 and 500 then
    raise exception 'Prize allocation unavailable' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jumping-race:prize:week:' || p_week::text, 0));
  select * into p from private.jumping_race_prize_program where singleton and enabled for update;
  if not found or p_week < p.inaugural_week_start then
    raise exception 'Prize period unavailable' using errcode = 'P0001';
  end if;
  select * into c from private.jr_prize_effective_candidates(p_week)
  where player_id = p_player and effective_rank between 1 and 3;
  if not found or c.state <> 'approved' then
    raise exception 'Candidate approval unavailable' using errcode = 'P0001';
  end if;
  v_amount := case c.effective_rank when 1 then 500 when 2 then 300 when 3 then 200 else null end;
  if v_amount is null then raise exception 'Prize allocation unavailable' using errcode = 'P0001'; end if;
  select id into v_game from public.games where slug = 'jumping-race' and status = 'active';
  if v_game is null then raise exception 'Game unavailable' using errcode = 'P0001'; end if;
  select * into v_winner from public.provisional_winners
  where game_id = v_game and tournament_week_start = p_week
    and award_type = 'weekly_tournament' and player_id = p_player for update;
  if not found then
    insert into public.provisional_winners
      (game_id, player_id, tournament_week_start, award_type, rank_position, amount_cents,
       allocation_status, status, claim_deadline_at, admin_note)
    values
      (v_game, p_player, p_week, 'weekly_tournament', c.effective_rank, v_amount,
       'allocated', 'provisional', clock_timestamp() + interval '90 days',
       'Jumping Race weekly prize: ' || left(btrim(p_note), 420))
    returning * into v_winner;
  elsif v_winner.rank_position is distinct from c.effective_rank
     or v_winner.amount_cents is distinct from v_amount
     or v_winner.allocation_status <> 'allocated' then
    raise exception 'Existing allocation conflict' using errcode = '23514';
  end if;
  if v_winner.status = 'approved_for_payment' then
    return jsonb_build_object('winnerId', v_winner.id, 'amountCents', v_amount,
      'idempotent', true, 'paymentsEnabled', false);
  end if;
  if v_winner.status not in ('provisional', 'verified') then
    raise exception 'Existing award state unavailable' using errcode = 'P0001';
  end if;
  if v_winner.status = 'provisional' then
    perform public.rtw_admin_transition_winner(p_actor, v_winner.id, 'under_review',
      'Jumping Race approved candidate entered financial review.');
    perform public.rtw_admin_transition_winner(p_actor, v_winner.id, 'verified',
      'Jumping Race candidate approved after manual review.');
  end if;
  perform public.rtw_admin_transition_winner(p_actor, v_winner.id, 'approved_for_payment',
    'Jumping Race financial credit approved by owner.');
  insert into private.jumping_race_prize_winner_case_events (week, player_id, actor, decision, note)
  values (p_week, p_player, p_actor, 'financial_credit_approved', btrim(p_note));
  return jsonb_build_object('winnerId', v_winner.id, 'amountCents', v_amount,
    'idempotent', false, 'paymentsEnabled', false);
end;
$$;

revoke all on function private.jr_prize_standings(date),
  private.jr_prize_effective_candidates(date), private.jr_open_prize_cases(date),
  private.jr_is_confirmed_financial_owner(uuid) from public, anon, authenticated, service_role;
revoke all on function public.jr_activate_prize_program(uuid),
  public.jr_close_prize_period(uuid, date),
  public.jr_decide_prize_candidate(uuid, date, uuid, text, text),
  public.jr_admin_allocate_prize(uuid, date, uuid, text) from public, anon, authenticated;
grant execute on function public.jr_activate_prize_program(uuid),
  public.jr_close_prize_period(uuid, date),
  public.jr_decide_prize_candidate(uuid, date, uuid, text, text),
  public.jr_admin_allocate_prize(uuid, date, uuid, text) to service_role;
