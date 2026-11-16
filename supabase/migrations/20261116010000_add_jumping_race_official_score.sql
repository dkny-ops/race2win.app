-- Jumping Race official-score foundation. This migration is intentionally
-- isolated from Race To Win, Flappy Race, prizes, balances and payouts.
-- Competition starts disabled; a separate, reviewed operation is required to
-- enable it after the application routes have passed production verification.

create table if not exists private.jumping_race_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into private.jumping_race_control(singleton, enabled)
values (true, false) on conflict (singleton) do nothing;

create table if not exists private.jumping_race_allowance_windows (
  player_id uuid not null references auth.users(id) on delete restrict,
  hour_started_at timestamptz not null,
  plays_consumed smallint not null default 0 check (plays_consumed between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, hour_started_at)
);

create table if not exists private.jumping_race_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete restrict,
  start_request_id uuid not null,
  session_nonce uuid not null default gen_random_uuid(),
  gameplay_version text not null check (gameplay_version = 'jumping-race-v1'),
  hour_started_at timestamptz not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active','finalized','rejected','expired')),
  next_checkpoint integer not null default 1 check (next_checkpoint >= 1),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (player_id, start_request_id),
  check (expires_at > started_at)
);
create index if not exists jumping_race_sessions_active_idx
  on private.jumping_race_sessions(player_id, status, expires_at);

create table if not exists private.jumping_race_action_batches (
  session_id uuid not null references private.jumping_race_sessions(id) on delete restrict,
  checkpoint_index integer not null check (checkpoint_index >= 1),
  actions jsonb not null check (jsonb_typeof(actions) = 'array'),
  action_digest text not null check (action_digest ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  primary key (session_id, checkpoint_index),
  unique (session_id, action_digest)
);

create table if not exists private.jumping_race_results (
  session_id uuid primary key references private.jumping_race_sessions(id) on delete restrict,
  player_id uuid not null references auth.users(id) on delete restrict,
  hour_started_at timestamptz not null,
  score integer not null check (score >= 0),
  elapsed_ms integer not null check (elapsed_ms >= 0),
  action_digest text not null check (action_digest ~ '^[0-9a-f]{64}$'),
  result_status text not null check (result_status in ('verified','pending_review','rejected')),
  rejection_reason text,
  telemetry jsonb not null default '{}'::jsonb check (jsonb_typeof(telemetry) = 'object'),
  finalized_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict,
  review_reason text,
  check ((result_status <> 'rejected') or rejection_reason is not null),
  check ((reviewed_at is null) = (reviewed_by is null))
);
create index if not exists jumping_race_results_hour_rank_idx
  on private.jumping_race_results(hour_started_at, player_id, score desc, finalized_at asc)
  where result_status = 'verified';

create table if not exists private.jumping_race_audit_events (
  id bigint generated always as identity primary key,
  session_id uuid references private.jumping_race_sessions(id) on delete restrict,
  player_id uuid references auth.users(id) on delete restrict,
  event_type text not null check (event_type in ('started','checkpoint','finalized','rejected','review_required')),
  created_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);

alter table private.jumping_race_control enable row level security;
alter table private.jumping_race_allowance_windows enable row level security;
alter table private.jumping_race_sessions enable row level security;
alter table private.jumping_race_action_batches enable row level security;
alter table private.jumping_race_results enable row level security;
alter table private.jumping_race_audit_events enable row level security;
revoke all on table private.jumping_race_control, private.jumping_race_allowance_windows,
  private.jumping_race_sessions, private.jumping_race_action_batches,
  private.jumping_race_results, private.jumping_race_audit_events from public, anon, authenticated;
grant select, insert, update on table private.jumping_race_control, private.jumping_race_allowance_windows,
  private.jumping_race_sessions, private.jumping_race_action_batches,
  private.jumping_race_results, private.jumping_race_audit_events to service_role;

create or replace function private.jumping_race_hour_start(p_at timestamptz default now())
returns timestamptz language sql stable set search_path = '' as $$
  select date_trunc('hour', p_at)
$$;

create or replace function public.jr_read_allowance(p_player_id uuid)
returns table(hour_started_at timestamptz, hour_ends_at timestamptz, plays_remaining integer)
language plpgsql security definer set search_path = '' as $$
declare v_hour timestamptz := private.jumping_race_hour_start(now()); v_used integer;
begin
  if p_player_id is null then raise exception 'Invalid allowance request.' using errcode='22023'; end if;
  select plays_consumed into v_used from private.jumping_race_allowance_windows
    where player_id=p_player_id and hour_started_at=v_hour;
  return query select v_hour, v_hour + interval '1 hour', greatest(0, 5 - coalesce(v_used, 0));
end;
$$;

create or replace function public.jr_start_session(p_player_id uuid, p_request_id uuid)
returns table(id uuid, session_nonce uuid, started_at timestamptz, expires_at timestamptz, plays_remaining integer)
language plpgsql security definer set search_path = '' as $$
declare v_hour timestamptz := private.jumping_race_hour_start(now()); v_session private.jumping_race_sessions%rowtype; v_used integer;
begin
  if p_player_id is null or p_request_id is null then raise exception 'Invalid session request.' using errcode='22023'; end if;
  if not (select enabled from private.jumping_race_control where singleton) then raise exception 'Jumping Race competition is disabled.' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('jumping-race:allowance:' || p_player_id::text || ':' || v_hour::text, 0));
  select * into v_session from private.jumping_race_sessions where player_id=p_player_id and start_request_id=p_request_id for update;
  if found then
    select plays_consumed into v_used from private.jumping_race_allowance_windows where player_id=p_player_id and hour_started_at=v_session.hour_started_at;
    return query select v_session.id, v_session.session_nonce, v_session.started_at, v_session.expires_at, greatest(0,5-coalesce(v_used,0)); return;
  end if;
  insert into private.jumping_race_allowance_windows(player_id,hour_started_at) values(p_player_id,v_hour) on conflict do nothing;
  select plays_consumed into v_used from private.jumping_race_allowance_windows where player_id=p_player_id and hour_started_at=v_hour for update;
  if v_used >= 5 then raise exception 'Hourly official opportunities exhausted.' using errcode='P0001'; end if;
  update private.jumping_race_allowance_windows set plays_consumed=plays_consumed+1, updated_at=now()
    where player_id=p_player_id and hour_started_at=v_hour returning plays_consumed into v_used;
  insert into private.jumping_race_sessions(player_id,start_request_id,gameplay_version,hour_started_at,expires_at)
    values(p_player_id,p_request_id,'jumping-race-v1',v_hour,now()+interval '12 minutes') returning * into v_session;
  insert into private.jumping_race_audit_events(session_id,player_id,event_type) values(v_session.id,p_player_id,'started');
  return query select v_session.id,v_session.session_nonce,v_session.started_at,v_session.expires_at,greatest(0,5-v_used);
end;
$$;

create or replace function public.jr_store_checkpoint(p_session_id uuid, p_player_id uuid, p_checkpoint_index integer, p_actions jsonb, p_action_digest text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_session private.jumping_race_sessions%rowtype;
begin
  if p_session_id is null or p_player_id is null or p_checkpoint_index < 1 or jsonb_typeof(p_actions) <> 'array' or p_action_digest !~ '^[0-9a-f]{64}$' then raise exception 'Invalid checkpoint.' using errcode='22023'; end if;
  select * into v_session from private.jumping_race_sessions where id=p_session_id and player_id=p_player_id for update;
  if not found then raise exception 'Session unavailable.' using errcode='P0002'; end if;
  if v_session.status <> 'active' or now() >= v_session.expires_at then raise exception 'Session unavailable.' using errcode='P0001'; end if;
  if p_checkpoint_index <> v_session.next_checkpoint then raise exception 'Checkpoint sequence rejected.' using errcode='P0001'; end if;
  insert into private.jumping_race_action_batches(session_id,checkpoint_index,actions,action_digest) values(p_session_id,p_checkpoint_index,p_actions,p_action_digest);
  update private.jumping_race_sessions set next_checkpoint=next_checkpoint+1 where id=p_session_id;
  insert into private.jumping_race_audit_events(session_id,player_id,event_type,detail) values(p_session_id,p_player_id,'checkpoint',jsonb_build_object('checkpoint_index',p_checkpoint_index));
  return true;
end;
$$;

create or replace function public.jr_finalize_session(p_session_id uuid, p_player_id uuid, p_score integer, p_elapsed_ms integer, p_action_digest text, p_status text, p_reason text, p_telemetry jsonb)
returns table(result_status text, score integer, duplicate boolean)
language plpgsql security definer set search_path = '' as $$
declare v_session private.jumping_race_sessions%rowtype; v_result private.jumping_race_results%rowtype;
begin
  if p_session_id is null or p_player_id is null or p_score < 0 or p_elapsed_ms < 0 or p_action_digest !~ '^[0-9a-f]{64}$' or p_status not in ('verified','pending_review','rejected') or jsonb_typeof(p_telemetry) <> 'object' then raise exception 'Invalid finalization.' using errcode='22023'; end if;
  select * into v_session from private.jumping_race_sessions where id=p_session_id and player_id=p_player_id for update;
  if not found then raise exception 'Session unavailable.' using errcode='P0002'; end if;
  select * into v_result from private.jumping_race_results where session_id=p_session_id;
  if found then return query select v_result.result_status,v_result.score,true; return; end if;
  if v_session.status <> 'active' or now() >= v_session.expires_at then raise exception 'Session unavailable.' using errcode='P0001'; end if;
  insert into private.jumping_race_results(session_id,player_id,hour_started_at,score,elapsed_ms,action_digest,result_status,rejection_reason,telemetry)
    values(p_session_id,p_player_id,v_session.hour_started_at,p_score,p_elapsed_ms,p_action_digest,p_status,case when p_status='rejected' then coalesce(p_reason,'server_rejected') else null end,p_telemetry)
    returning * into v_result;
  update private.jumping_race_sessions set status=case when p_status='rejected' then 'rejected' else 'finalized' end, finalized_at=now() where id=p_session_id;
  insert into private.jumping_race_audit_events(session_id,player_id,event_type,detail) values(p_session_id,p_player_id,case when p_status='verified' then 'finalized' when p_status='pending_review' then 'review_required' else 'rejected' end,jsonb_build_object('score',p_score));
  return query select v_result.result_status,v_result.score,false;
end;
$$;

create or replace function public.jr_hourly_leaderboard(p_hour_started_at timestamptz default date_trunc('hour',now()), p_offset integer default 0, p_limit integer default 50)
returns table(position bigint, player text, top_1 integer, top_2 integer, top_3 integer, total integer, tied_for_review boolean)
language sql stable security definer set search_path = '' as $$
  with per_player as (
    select r.player_id, array_agg(r.score order by r.score desc, r.finalized_at asc) filter (where r.result_status='verified') as scores
    from private.jumping_race_results r where r.hour_started_at=p_hour_started_at group by r.player_id
  ), ranked as (
    select p.player_id, coalesce(p.scores[1],0) top_1, coalesce(p.scores[2],0) top_2, coalesce(p.scores[3],0) top_3
    from per_player p
  ), ordered as (
    select row_number() over(order by top_1+top_2+top_3 desc, top_1 desc, top_2 desc, top_3 desc, player_id asc) position, ranked.*,
      count(*) over(partition by top_1+top_2+top_3,top_1,top_2,top_3) > 1 tied_for_review from ranked
  )
  select o.position, coalesce(pr.username,'Player')::text, o.top_1,o.top_2,o.top_3,(o.top_1+o.top_2+o.top_3)::integer,o.tied_for_review
  from ordered o left join public.profiles pr on pr.user_id=o.player_id
  where p_offset between 0 and 10000 and p_limit between 1 and 50
  order by o.position offset p_offset limit p_limit
$$;

-- Personal weekly score mirrors the approved Race To Win presentation rule:
-- the seven highest verified runs for each New York calendar day are summed.
-- This is a private server read; it never creates a tournament, prize or credit.
create or replace function public.jr_personal_weekly_score(p_player_id uuid, p_week_start date default date_trunc('week', now() at time zone 'America/New_York')::date)
returns table(score_day date, daily_top_scores integer[], daily_total integer, weekly_total integer)
language sql stable security definer set search_path = '' as $$
  with bounds as (
    select p_week_start as week_start, (p_week_start + 6) as week_end
  ), runs as (
    select (r.finalized_at at time zone 'America/New_York')::date as score_day, r.score, r.finalized_at
    from private.jumping_race_results r, bounds b
    where r.player_id = p_player_id
      and r.result_status = 'verified'
      and (r.finalized_at at time zone 'America/New_York')::date between b.week_start and b.week_end
  ), ranked as (
    select *, row_number() over (partition by score_day order by score desc, finalized_at asc) as daily_rank
    from runs
  ), daily as (
    select score_day, array_agg(score order by score desc, finalized_at asc) filter (where daily_rank <= 7) as daily_top_scores,
      coalesce(sum(score) filter (where daily_rank <= 7), 0)::integer as daily_total
    from ranked group by score_day
  ), days as (
    select generate_series(b.week_start, b.week_end, interval '1 day')::date as score_day from bounds b
  ), materialized as (
    select days.score_day, coalesce(daily.daily_top_scores, '{}'::integer[]) as daily_top_scores, coalesce(daily.daily_total, 0)::integer as daily_total
    from days left join daily using (score_day)
  )
  select score_day, daily_top_scores, daily_total, sum(daily_total) over ()::integer as weekly_total
  from materialized order by score_day
$$;

revoke all on function private.jumping_race_hour_start(timestamptz) from public, anon, authenticated;
revoke all on function public.jr_read_allowance(uuid), public.jr_start_session(uuid,uuid), public.jr_store_checkpoint(uuid,uuid,integer,jsonb,text), public.jr_finalize_session(uuid,uuid,integer,integer,text,text,text,jsonb), public.jr_personal_weekly_score(uuid,date) from public, anon, authenticated;
grant execute on function public.jr_read_allowance(uuid), public.jr_start_session(uuid,uuid), public.jr_store_checkpoint(uuid,uuid,integer,jsonb,text), public.jr_finalize_session(uuid,uuid,integer,integer,text,text,text,jsonb), public.jr_personal_weekly_score(uuid,date) to service_role;
revoke all on function public.jr_hourly_leaderboard(timestamptz,integer,integer) from public;
grant execute on function public.jr_hourly_leaderboard(timestamptz,integer,integer) to anon, authenticated, service_role;

