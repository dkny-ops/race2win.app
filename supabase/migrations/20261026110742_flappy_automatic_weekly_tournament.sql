-- FlappyRace automatic weekly scoring and candidate-only review.
-- Scope is limited to private.flappy_* objects and service-role RPCs.
-- No Race To Win, wallet, prize, payment, advertisement, or reward object is changed.

alter table private.flappy_control
  add column if not exists automatic_ranking_since timestamptz;

update private.flappy_control
set automatic_ranking_since = clock_timestamp()
where singleton and automatic_ranking_since is null;

alter table private.flappy_runs drop constraint if exists flappy_runs_check;
alter table private.flappy_runs drop constraint if exists flappy_runs_check1;
alter table private.flappy_runs
  add constraint flappy_runs_review_metadata_check check (
    (eligibility = 'under_review' and reviewed_at is null and review_actor is null and review_note is null)
    or (eligibility = 'valid' and (
      (reviewed_at is null and review_actor is null and review_note is null)
      or (reviewed_at is not null and review_actor is not null and length(review_note) between 1 and 500)
    ))
    or (eligibility = 'disqualified' and reviewed_at is not null and review_actor is not null and length(review_note) between 1 and 500)
  );

alter table private.flappy_week_closures alter column actor drop not null;
alter table private.flappy_week_closures
  add column if not exists closure_source text not null default 'manual'
  check (closure_source in ('manual','automatic'));

create table private.flappy_winner_cases (
  week date not null references private.flappy_week_closures(week) on delete restrict,
  player_id uuid not null references auth.users(id) on delete restrict,
  opening_rank integer not null check (opening_rank between 1 and 3),
  state text not null default 'pending_review'
    check (state in ('pending_review','needs_additional_review','approved','rejected')),
  review_actor uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (week, player_id),
  check (
    (state in ('pending_review','needs_additional_review') and review_actor is null and reviewed_at is null and review_note is null)
    or (state in ('approved','rejected') and review_actor is not null and reviewed_at is not null and length(review_note) between 1 and 500)
  )
);

create table private.flappy_winner_case_events (
  id uuid primary key default gen_random_uuid(),
  week date not null,
  player_id uuid not null,
  actor uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected','needs_additional_review')),
  note text not null check (length(note) between 1 and 500),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (week, player_id) references private.flappy_winner_cases(week, player_id) on delete restrict
);

create index flappy_winner_cases_queue on private.flappy_winner_cases(week, state, created_at);
create index flappy_winner_case_events_history on private.flappy_winner_case_events(week, player_id, created_at);

alter table private.flappy_winner_cases enable row level security;
alter table private.flappy_winner_case_events enable row level security;
revoke all on private.flappy_winner_cases, private.flappy_winner_case_events from public, anon, authenticated, service_role;

create or replace function private.flappy_effective_candidates(p_week date)
returns table(player_id uuid, username text, weekly_total bigint, scores integer[], effective_rank integer)
language sql stable security definer set search_path='' as $$
  with eligible as (
    select r.player_id, r.username, r.weekly_total, r.scores
    from private.flappy_week_results r
    where r.week = p_week
      and r.rank_position is not null
      and not r.review_required
      and not exists (
        select 1 from private.flappy_winner_cases c
        where c.week = p_week and c.player_id = r.player_id and c.state = 'rejected'
      )
  ), ranked as (
    select e.*, row_number() over (order by e.weekly_total desc, e.scores desc, e.player_id) as effective_rank
    from eligible e
  )
  select player_id, username, weekly_total, scores, effective_rank::integer from ranked;
$$;
revoke all on function private.flappy_effective_candidates(date) from public, anon, authenticated, service_role;

create or replace function private.flappy_open_top_cases(p_week date)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into private.flappy_winner_cases(week, player_id, opening_rank)
  select p_week, c.player_id, c.effective_rank
  from private.flappy_effective_candidates(p_week) c
  where c.effective_rank <= 3
  on conflict (week, player_id) do nothing;
end;
$$;
revoke all on function private.flappy_open_top_cases(date) from public, anon, authenticated, service_role;

create or replace function public.flappy_record_evidence(
  p_player uuid,p_session uuid,p_action text,p_expected_tick integer,
  p_inputs integer[],p_tick integer,p_digest text,p_score integer
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  s private.flappy_sessions%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_completed timestamptz;
  v_outcome jsonb;
  v_prev integer:=-4;
  v_input integer;
begin
  if not exists(select 1 from private.flappy_control where enabled) then raise exception 'Disabled'; end if;
  select s0.* into s
  from private.flappy_sessions s0
  join public.games g on g.id=s0.game_id and g.slug='flappy-race'
  where s0.id=p_session and s0.player_id=p_player
  for update of s0;
  if not found then raise exception 'Session unavailable'; end if;
  if p_action is null or p_action not in ('checkpoint','finalize') or p_inputs is null or p_tick is null or p_digest is null or p_score is null
    or cardinality(p_inputs)>6000 or p_tick<1 or p_tick>36000 or p_score<0 or p_score>500
    or p_digest !~ '^[a-f0-9]{64}$'
    or coalesce(array_ndims(p_inputs),1)<>1 or (cardinality(p_inputs)>0 and array_lower(p_inputs,1)<>1)
  then raise exception 'Invalid evidence'; end if;
  foreach v_input in array p_inputs loop
    if v_input is null or v_input<0 or v_input>=p_tick or v_input-v_prev<4 then raise exception 'Invalid input'; end if;
    v_prev:=v_input;
  end loop;
  if s.status='finalized' then
    if p_action='finalize' and p_tick=s.tick and p_digest=s.digest and p_inputs=s.inputs
      and p_score=(s.outcome->>'score')::integer then return s.outcome; end if;
    raise exception 'Finalization conflict';
  end if;
  if s.status<>'active' or v_now>s.expires_at or v_now>s.lease_until or v_now<s.starts_at then raise exception 'Expired'; end if;
  if p_expected_tick is distinct from s.tick or p_tick<s.tick
    or p_tick>floor(extract(epoch from (v_now-s.starts_at))*60)+2 then raise exception 'Evidence timing'; end if;
  if cardinality(p_inputs)<cardinality(s.inputs)
    or (cardinality(s.inputs)>0 and p_inputs[1:cardinality(s.inputs)]<>s.inputs)
    or exists(select 1 from unnest(p_inputs) with ordinality t(value,n)
              where n>cardinality(s.inputs) and value<s.tick) then raise exception 'Prefix conflict'; end if;
  if p_tick=s.tick then
    if p_action='checkpoint' and p_digest=s.digest and p_inputs=s.inputs then
      return jsonb_build_object('checkpointTick',s.tick);
    end if;
    raise exception 'No progress';
  end if;
  if p_action='checkpoint' then
    update private.flappy_sessions
    set inputs=p_inputs,tick=p_tick,digest=p_digest,lease_until=least(expires_at,v_now+interval '15 seconds')
    where id=s.id;
    return jsonb_build_object('checkpointTick',p_tick);
  end if;
  v_outcome:=jsonb_build_object(
    'score',p_score,'collisionTick',p_tick,'eligibility','valid','verification','replay_verified'
  );
  v_completed:=s.starts_at+(p_tick::double precision/60)*interval '1 second';
  insert into private.flappy_runs(
    session_id,player_id,game_id,score,collision_tick,completed_at,tournament_day,tournament_week_start,eligibility
  ) values(
    s.id,s.player_id,s.game_id,p_score,p_tick,v_completed,
    (v_completed at time zone 'America/New_York')::date,
    date_trunc('week',v_completed at time zone 'America/New_York')::date,
    'valid'
  );
  update private.flappy_sessions
  set status='finalized',inputs=p_inputs,tick=p_tick,digest=p_digest,outcome=v_outcome
  where id=s.id;
  return v_outcome;
end $$;

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
  return jsonb_build_object('week',c.week,'closedAt',c.closed_at,'source',c.closure_source);
end $$;

create or replace function public.flappy_auto_close_previous_week()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_week date;
begin
  v_week:=date_trunc('week',(clock_timestamp() at time zone 'America/New_York')::date)::date-7;
  return public.flappy_close_week(null,v_week);
exception when others then
  return jsonb_build_object('week',v_week,'status','not_ready');
end $$;

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
    'prizesEnabled',false,
    'paymentsEnabled',false
  ) end;
$$;

create or replace function public.flappy_admin_read_winner_cases(p_actor uuid,p_week date)
returns jsonb language sql stable security definer set search_path='' as $$
  with authorized as (
    select exists(select 1 from private.admin_users where user_id=p_actor and is_active) as allowed
  ), cases as (
    select
      wc.week,wc.player_id,wc.opening_rank,wc.state,wc.reviewed_at,wc.review_note,wc.created_at,wc.updated_at,
      wr.username,wr.weekly_total,wr.scores,ec.effective_rank
    from private.flappy_winner_cases wc
    join private.flappy_week_results wr on wr.week=wc.week and wr.player_id=wc.player_id
    left join private.flappy_effective_candidates(p_week) ec on ec.player_id=wc.player_id
    where wc.week=p_week
  ), packed as (
    select jsonb_build_object(
      'playerId',c.player_id,
      'username',c.username,
      'openingRank',c.opening_rank,
      'effectiveRank',c.effective_rank,
      'state',c.state,
      'weeklyTotal',c.weekly_total,
      'scores',c.scores,
      'createdAt',c.created_at,
      'reviewedAt',c.reviewed_at,
      'reviewNote',c.review_note,
      'dailyTopSeven',coalesce((
        select jsonb_agg(jsonb_build_object('day',day_rows.tournament_day,'runs',day_rows.runs) order by day_rows.tournament_day)
        from (
          select d.tournament_day,jsonb_agg(jsonb_build_object(
            'sessionId',d.session_id,'score',d.score,'completedAt',d.completed_at,
            'collisionTick',d.collision_tick,'digest',s.digest,'version',s.version,
            'inputCount',cardinality(s.inputs),'replayVerified',(s.outcome->>'verification'='replay_verified')
          ) order by d.score desc,d.session_id) as runs
          from (
            select r.*,row_number() over(partition by r.tournament_day order by r.score desc,r.session_id) as daily_rank
            from private.flappy_runs r
            where r.player_id=c.player_id and r.tournament_week_start=p_week and r.eligibility='valid'
          ) d join private.flappy_sessions s on s.id=d.session_id
          where d.daily_rank<=7
          group by d.tournament_day
        ) day_rows
      ),'[]'::jsonb),
      'history',coalesce((
        select jsonb_agg(jsonb_build_object('decision',e.decision,'note',e.note,'at',e.created_at) order by e.created_at)
        from private.flappy_winner_case_events e
        where e.week=c.week and e.player_id=c.player_id
      ),'[]'::jsonb)
    ) as value,
    coalesce(c.effective_rank,999) as display_rank,c.created_at
    from cases c
  )
  select case when (select allowed from authorized) and extract(isodow from p_week)=1 then
    jsonb_build_object(
      'week',p_week,
      'closedAt',(select closed_at from private.flappy_week_closures where week=p_week),
      'exactTiesPending',exists(select 1 from private.flappy_week_results where week=p_week and review_required),
      'candidates',coalesce((select jsonb_agg(value order by display_rank,created_at) from packed),'[]'::jsonb),
      'prizesEnabled',false,
      'paymentsEnabled',false
    )
  else null end;
$$;

create or replace function public.flappy_decide_winner_candidate(
  p_actor uuid,p_week date,p_player uuid,p_decision text,p_note text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_case private.flappy_winner_cases%rowtype;
begin
  if not exists(select 1 from private.admin_users where user_id=p_actor and is_active)
    or p_week is null or extract(isodow from p_week)<>1
    or p_player is null or p_decision not in ('approved','rejected','needs_additional_review')
    or p_note is null or length(btrim(p_note)) not between 1 and 500
  then raise exception 'Candidate review unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('flappy:week:'||p_week::text,0));
  if not exists(select 1 from private.flappy_week_closures where week=p_week) then raise exception 'Week unavailable'; end if;
  select * into v_case from private.flappy_winner_cases
  where week=p_week and player_id=p_player for update;
  if not found then raise exception 'Candidate unavailable'; end if;
  if v_case.state in ('approved','rejected') then
    if v_case.state=p_decision and v_case.review_actor=p_actor and v_case.review_note=btrim(p_note) then
      return jsonb_build_object('state',v_case.state,'idempotent',true);
    end if;
    raise exception 'Candidate already resolved';
  end if;
  if not exists(select 1 from private.flappy_effective_candidates(p_week) where player_id=p_player and effective_rank<=3) then
    raise exception 'Candidate no longer current';
  end if;
  insert into private.flappy_winner_case_events(week,player_id,actor,decision,note)
  values(p_week,p_player,p_actor,p_decision,btrim(p_note));
  update private.flappy_winner_cases
  set state=p_decision,
      review_actor=case when p_decision='needs_additional_review' then null else p_actor end,
      reviewed_at=case when p_decision='needs_additional_review' then null else clock_timestamp() end,
      review_note=case when p_decision='needs_additional_review' then null else btrim(p_note) end,
      updated_at=clock_timestamp()
  where week=p_week and player_id=p_player;
  perform private.flappy_open_top_cases(p_week);
  return jsonb_build_object('state',p_decision,'prizesEnabled',false,'paymentsEnabled',false);
end $$;

revoke all on function public.flappy_record_evidence(uuid,uuid,text,integer,integer[],integer,text,integer),
  public.flappy_close_week(uuid,date),public.flappy_auto_close_previous_week(),
  public.flappy_read_week(date),public.flappy_admin_read_winner_cases(uuid,date),
  public.flappy_decide_winner_candidate(uuid,date,uuid,text,text)
from public,anon,authenticated;
grant execute on function public.flappy_record_evidence(uuid,uuid,text,integer,integer[],integer,text,integer),
  public.flappy_close_week(uuid,date),public.flappy_auto_close_previous_week(),
  public.flappy_read_week(date),public.flappy_admin_read_winner_cases(uuid,date),
  public.flappy_decide_winner_candidate(uuid,date,uuid,text,text)
to service_role;

select cron.schedule(
  'flappy_auto_close_previous_week',
  '20 5 * * *',
  $cron$select public.flappy_auto_close_previous_week();$cron$
)
where not exists(
  select 1 from cron.job where jobname='flappy_auto_close_previous_week'
);