-- FlappyRace real-prize program.  It deliberately reuses the shared Race To Win
-- financial ledger only after an authenticated owner explicitly approves a frozen
-- candidate.  Historical Flappy standings remain untouched.
create table private.flappy_prize_program (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  activated_at timestamptz,
  inaugural_week_start date,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (not enabled and activated_at is null and inaugural_week_start is null)
    or (enabled and activated_at is not null and inaugural_week_start is not null
        and extract(isodow from inaugural_week_start)=1)
  )
);

insert into private.flappy_prize_program(singleton) values(true)
on conflict(singleton) do nothing;

create table private.flappy_prize_period_results (
  week date not null check (extract(isodow from week)=1),
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

create table private.flappy_prize_winner_cases (
  week date not null,
  player_id uuid not null,
  opening_rank integer not null check (opening_rank between 1 and 3),
  state text not null default 'pending_review'
    check (state in ('pending_review','needs_additional_review','approved','rejected')),
  review_actor uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (week, player_id),
  foreign key (week, player_id)
    references private.flappy_prize_period_results(week, player_id) on delete restrict,
  check (
    (state in ('pending_review','needs_additional_review')
      and review_actor is null and reviewed_at is null and review_note is null)
    or (state in ('approved','rejected')
      and review_actor is not null and reviewed_at is not null
      and length(review_note) between 1 and 500)
  )
);

create table private.flappy_prize_winner_case_events (
  id uuid primary key default gen_random_uuid(),
  week date not null,
  player_id uuid not null,
  actor uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected','needs_additional_review','financial_credit_approved')),
  note text not null check (length(note) between 1 and 500),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (week, player_id)
    references private.flappy_prize_winner_cases(week, player_id) on delete restrict
);

create index flappy_prize_cases_queue
  on private.flappy_prize_winner_cases(week, state, created_at);
create index flappy_prize_case_events_history
  on private.flappy_prize_winner_case_events(week, player_id, created_at);

alter table private.flappy_prize_program enable row level security;
alter table private.flappy_prize_period_results enable row level security;
alter table private.flappy_prize_winner_cases enable row level security;
alter table private.flappy_prize_winner_case_events enable row level security;
revoke all on private.flappy_prize_program, private.flappy_prize_period_results,
  private.flappy_prize_winner_cases, private.flappy_prize_winner_case_events
from public, anon, authenticated, service_role;

create function private.flappy_prize_standings(p_week date)
returns table(player_id uuid, username text, weekly_total bigint, scores integer[],
              rank_position integer, review_required boolean)
language sql stable security definer set search_path='' as $$
  with program as (
    select activated_at
    from private.flappy_prize_program
    where singleton and enabled
  ), daily as (
    select r.player_id, r.tournament_day, r.score, r.session_id,
      row_number() over (
        partition by r.player_id, r.tournament_day
        order by r.score desc, r.session_id
      ) as daily_rank
    from private.flappy_runs r
    join private.flappy_sessions s on s.id=r.session_id
    join public.games g on g.id=r.game_id and g.slug='flappy-race'
    cross join program p
    where r.tournament_week_start=p_week
      and r.eligibility='valid'
      and s.starts_at >= p.activated_at
  ), vectors as (
    select d.player_id,
      sum(d.score) filter(where d.daily_rank<=7)::bigint as total,
      array_agg(d.score order by d.score desc, d.session_id)
        filter(where d.daily_rank<=7) as score_vector
    from daily d
    group by d.player_id
  ), ranked as (
    select v.*,
      rank() over(order by v.total desc, v.score_vector desc) as position,
      count(*) over(partition by v.total, v.score_vector)>1 as tied
    from vectors v
  )
  select r.player_id, p.username, r.total, r.score_vector,
    case when r.tied then null else r.position::integer end,
    r.tied
  from ranked r
  join public.profiles p on p.user_id=r.player_id
  where p.username is not null;
$$;

create function private.flappy_prize_effective_candidates(p_week date)
returns table(player_id uuid, username text, weekly_total bigint, scores integer[],
              opening_rank integer, state text, effective_rank integer)
language sql stable security definer set search_path='' as $$
  with eligible as (
    select r.player_id,r.username,r.weekly_total,r.scores,r.rank_position,
      coalesce(c.state,'pending_review') as state
    from private.flappy_prize_period_results r
    left join private.flappy_prize_winner_cases c
      on c.week=r.week and c.player_id=r.player_id
    where r.week=p_week and r.rank_position is not null and not r.review_required
      and coalesce(c.state,'pending_review')<>'rejected'
  ), ranked as (
    select e.*,row_number() over(order by e.rank_position,e.player_id) as effective_rank
    from eligible e
  )
  select player_id,username,weekly_total,scores,rank_position,state,effective_rank::integer
  from ranked;
$$;

create function private.flappy_open_prize_cases(p_week date)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into private.flappy_prize_winner_cases(week,player_id,opening_rank)
  select p_week,c.player_id,c.effective_rank
  from private.flappy_prize_effective_candidates(p_week) c
  where c.effective_rank<=3
  on conflict(week,player_id) do nothing;
end;
$$;

create function private.flappy_close_prize_period(p_week date)
returns void language plpgsql security definer set search_path='' as $$
declare p private.flappy_prize_program%rowtype;
begin
  select * into p from private.flappy_prize_program where singleton for update;
  if not found or not p.enabled or p_week<p.inaugural_week_start then return; end if;
  if exists(select 1 from private.flappy_prize_period_results where week=p_week) then return; end if;
  insert into private.flappy_prize_period_results(
    week,player_id,username,weekly_total,scores,rank_position,review_required
  )
  select p_week,s.player_id,s.username,s.weekly_total,s.scores,s.rank_position,s.review_required
  from private.flappy_prize_standings(p_week) s;
  perform private.flappy_open_prize_cases(p_week);
end;
$$;

create or replace function public.flappy_close_week(p_actor uuid,p_week date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c private.flappy_week_closures%rowtype;
  v_auto_since timestamptz;
  v_previous_week date:=date_trunc('week',(clock_timestamp() at time zone 'America/New_York')::date)::date-7;
begin
  if p_week is null or extract(isodow from p_week)<>1 then raise exception 'Close unavailable'; end if;
  if p_actor is not null and not exists(
    select 1 from private.admin_users where user_id=p_actor and is_active
  ) then raise exception 'Close unavailable'; end if;
  if p_actor is null and p_week is distinct from v_previous_week then
    raise exception 'Automated closure unavailable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('flappy:week:'||p_week::text,0));
  select * into c from private.flappy_week_closures where week=p_week;
  if found then return jsonb_build_object('week',c.week,'closedAt',c.closed_at,'source',c.closure_source); end if;
  if clock_timestamp()<((p_week+7)::timestamp at time zone 'America/New_York')+interval '11 minutes' then
    raise exception 'Week not ready';
  end if;
  select automatic_ranking_since into v_auto_since from private.flappy_control where singleton;
  if v_auto_since is not null and exists(
    select 1 from private.flappy_runs
    where tournament_week_start=p_week and eligibility='under_review' and completed_at>=v_auto_since
  ) then raise exception 'Week awaits verifiable fraud review'; end if;
  insert into private.flappy_week_closures(week,actor,closure_source)
  values(p_week,p_actor,case when p_actor is null then 'automatic' else 'manual' end)
  returning * into c;
  insert into private.flappy_week_results(
    week,player_id,username,weekly_total,scores,rank_position,review_required
  )
  select p_week,s.player_id,p.username,s.weekly_total,s.scores,s.rank_position,s.review_required
  from private.flappy_standings(p_week) s
  join public.profiles p on p.user_id=s.player_id
  where p.username is not null;
  perform private.flappy_open_top_cases(p_week);
  perform private.flappy_close_prize_period(p_week);
  return jsonb_build_object('week',c.week,'closedAt',c.closed_at,'source',c.closure_source);
end;
$$;

create function public.flappy_activate_prize_program(p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.flappy_prize_program%rowtype;
begin
  if not exists(select 1 from private.admin_users where user_id=p_actor and is_active) then
    raise exception 'Prize activation unavailable' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('flappy:prize:program',0));
  select * into p from private.flappy_prize_program where singleton for update;
  if p.enabled then
    return jsonb_build_object('enabled',true,'activatedAt',p.activated_at,'inauguralWeekStart',p.inaugural_week_start,'idempotent',true);
  end if;
  update private.flappy_prize_program
  set enabled=true,
      activated_at=clock_timestamp(),
      inaugural_week_start=date_trunc('week',(clock_timestamp() at time zone 'America/New_York')::date)::date,
      updated_at=clock_timestamp()
  where singleton
  returning * into p;
  return jsonb_build_object('enabled',true,'activatedAt',p.activated_at,'inauguralWeekStart',p.inaugural_week_start,'idempotent',false);
end;
$$;

create function public.flappy_decide_prize_candidate(
  p_actor uuid,p_week date,p_player uuid,p_decision text,p_note text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.flappy_prize_winner_cases%rowtype;
begin
  if not exists(select 1 from private.admin_users where user_id=p_actor and is_active)
     or p_week is null or extract(isodow from p_week)<>1
     or p_player is null or p_decision not in ('approved','rejected','needs_additional_review')
     or p_note is null or length(btrim(p_note)) not between 1 and 500
  then raise exception 'Prize review unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('flappy:prize:week:'||p_week::text,0));
  select * into c from private.flappy_prize_winner_cases
  where week=p_week and player_id=p_player for update;
  if not found then raise exception 'Candidate unavailable'; end if;
  if c.state in ('approved','rejected') then
    if c.state=p_decision and c.review_actor=p_actor and c.review_note=btrim(p_note) then
      return jsonb_build_object('state',c.state,'idempotent',true);
    end if;
    raise exception 'Candidate already resolved';
  end if;
  if not exists(select 1 from private.flappy_prize_effective_candidates(p_week)
                where player_id=p_player and effective_rank<=3) then
    raise exception 'Candidate no longer current'; end if;
  insert into private.flappy_prize_winner_case_events(week,player_id,actor,decision,note)
  values(p_week,p_player,p_actor,p_decision,btrim(p_note));
  update private.flappy_prize_winner_cases
  set state=p_decision,
      review_actor=case when p_decision='needs_additional_review' then null else p_actor end,
      reviewed_at=case when p_decision='needs_additional_review' then null else clock_timestamp() end,
      review_note=case when p_decision='needs_additional_review' then null else btrim(p_note) end,
      updated_at=clock_timestamp()
  where week=p_week and player_id=p_player;
  perform private.flappy_open_prize_cases(p_week);
  return jsonb_build_object('state',p_decision,'prizesEnabled',true,'paymentsEnabled',false);
end;
$$;

create function public.flappy_admin_allocate_prize(
  p_actor uuid,p_week date,p_player uuid,p_note text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  p private.flappy_prize_program%rowtype;
  c record;
  v_game uuid;
  v_amount integer;
  v_winner public.provisional_winners%rowtype;
begin
  if not exists(select 1 from private.admin_users where user_id=p_actor and is_active)
     or p_week is null or extract(isodow from p_week)<>1
     or p_player is null or p_note is null or length(btrim(p_note)) not between 1 and 500
  then raise exception 'Prize allocation unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('flappy:prize:week:'||p_week::text,0));
  select * into p from private.flappy_prize_program where singleton and enabled for update;
  if not found or p_week<p.inaugural_week_start then raise exception 'Prize period unavailable'; end if;
  select * into c from private.flappy_prize_effective_candidates(p_week)
  where player_id=p_player and effective_rank between 1 and 3;
  if not found or c.state<>'approved' then raise exception 'Candidate approval unavailable'; end if;
  v_amount:=case c.effective_rank when 1 then 1500 when 2 then 300 when 3 then 200 else null end;
  if v_amount is null then raise exception 'Prize allocation unavailable'; end if;
  select id into v_game from public.games where slug='flappy-race' and status='active';
  if v_game is null then raise exception 'Game unavailable'; end if;
  select * into v_winner from public.provisional_winners
  where game_id=v_game and tournament_week_start=p_week
    and award_type='weekly_tournament' and player_id=p_player
  for update;
  if not found then
    insert into public.provisional_winners(
      game_id,player_id,tournament_week_start,award_type,rank_position,amount_cents,
      allocation_status,status,claim_deadline_at,admin_note
    ) values (
      v_game,p_player,p_week,'weekly_tournament',c.effective_rank,v_amount,
      'allocated','provisional',clock_timestamp()+interval '90 days',
      'FlappyRace inaugural/weekly prize: '||left(btrim(p_note),420)
    ) returning * into v_winner;
  elsif v_winner.rank_position is distinct from c.effective_rank
     or v_winner.amount_cents is distinct from v_amount
     or v_winner.allocation_status<>'allocated' then
    raise exception 'Existing allocation conflict';
  end if;
  if v_winner.status='approved_for_payment' then
    return jsonb_build_object('winnerId',v_winner.id,'amountCents',v_amount,'idempotent',true,'paymentsEnabled',false);
  end if;
  if v_winner.status not in ('provisional','verified') then
    raise exception 'Existing award state unavailable';
  end if;
  if v_winner.status='provisional' then
    perform public.rtw_admin_transition_winner(p_actor,v_winner.id,'verified',
      'FlappyRace candidate approved after manual review.');
  end if;
  perform public.rtw_admin_transition_winner(p_actor,v_winner.id,'approved_for_payment',
    'FlappyRace financial credit approved by owner.');
  insert into private.flappy_prize_winner_case_events(week,player_id,actor,decision,note)
  values(p_week,p_player,p_actor,'financial_credit_approved',btrim(p_note));
  return jsonb_build_object('winnerId',v_winner.id,'amountCents',v_amount,'idempotent',false,'paymentsEnabled',false);
end;
$$;

create or replace function public.flappy_read_week(p_week date)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_week is null or extract(isodow from p_week)<>1 then null else
  jsonb_build_object(
    'week',p_week,
    'closedAt',(select closed_at from private.flappy_week_closures where week=p_week),
    'state',case
      when exists(select 1 from private.flappy_week_closures where week=p_week)
        and exists(select 1 from private.flappy_winner_cases where week=p_week and state in ('pending_review','needs_additional_review'))
        then 'candidate_review'
      when exists(select 1 from private.flappy_week_closures where week=p_week) then 'closed'
      when clock_timestamp()<((p_week+7)::timestamp at time zone 'America/New_York')+interval '11 minutes' then 'open'
      when exists(select 1 from private.flappy_runs r join private.flappy_control c on c.singleton
                  where r.tournament_week_start=p_week and r.eligibility='under_review' and r.completed_at>=c.automatic_ranking_since)
        then 'awaiting_review'
      else 'ready_to_close'
    end,
    'pendingRuns',(select count(*) from private.flappy_runs where tournament_week_start=p_week and eligibility='under_review'),
    'winners',coalesce((
      select jsonb_agg(jsonb_build_object('rank',ec.effective_rank,'username',ec.username,'weeklyTotal',ec.weekly_total) order by ec.effective_rank)
      from private.flappy_effective_candidates(p_week) ec
      join private.flappy_winner_cases wc on wc.week=p_week and wc.player_id=ec.player_id
      where wc.state='approved' and ec.effective_rank<=3
    ),'[]'::jsonb),
    'exactTiesPending',exists(select 1 from private.flappy_week_results where week=p_week and review_required),
    'prizesEnabled',coalesce((select enabled from private.flappy_prize_program where singleton),false),
    'prizeEffectiveAt',(select activated_at from private.flappy_prize_program where singleton),
    'prizeInauguralWeekStart',(select inaugural_week_start from private.flappy_prize_program where singleton),
    'paymentsEnabled',false
  ) end;
$$;

revoke all on function private.flappy_prize_standings(date),
  private.flappy_prize_effective_candidates(date), private.flappy_open_prize_cases(date),
  private.flappy_close_prize_period(date)
from public,anon,authenticated,service_role;
revoke all on function public.flappy_activate_prize_program(uuid),
  public.flappy_decide_prize_candidate(uuid,date,uuid,text,text),
  public.flappy_admin_allocate_prize(uuid,date,uuid,text)
from public,anon,authenticated;
grant execute on function public.flappy_activate_prize_program(uuid),
  public.flappy_decide_prize_candidate(uuid,date,uuid,text,text),
  public.flappy_admin_allocate_prize(uuid,date,uuid,text)
to service_role;