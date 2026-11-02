-- Additive Flappy-only infrastructure. No Race To Win table/trigger changes.
-- Both code activation and this independent database gate default to CLOSED.
create table private.flappy_control (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into private.flappy_control(singleton, enabled) values(true, false);
create table private.flappy_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete restrict,
  game_id uuid not null references public.games(id) on delete restrict,
  version text not null check(version = 'flappy-v1'),
  seed bigint not null check(seed between 0 and 4294967295),
  status text not null default 'active' check(status in ('active','finalized','expired')),
  created_at timestamptz not null default clock_timestamp(),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  lease_until timestamptz not null,
  tick integer not null default 0 check(tick between 0 and 36000),
  inputs integer[] not null default '{}' check(cardinality(inputs) <= 6000),
  digest text check(digest is null or digest ~ '^[a-f0-9]{64}$'),
  outcome jsonb,
  check(expires_at = starts_at + interval '10 minutes'),
  check((status='finalized') = (outcome is not null))
);
create index flappy_sessions_player_recent on private.flappy_sessions(player_id,created_at desc);
create unique index flappy_sessions_one_active on private.flappy_sessions(player_id) where status='active';
create table private.flappy_runs (
  session_id uuid primary key references private.flappy_sessions(id) on delete restrict,
  player_id uuid not null references auth.users(id) on delete restrict,
  game_id uuid not null references public.games(id) on delete restrict,
  score integer not null check(score between 0 and 500),
  collision_tick integer not null check(collision_tick between 1 and 36000),
  completed_at timestamptz not null,
  tournament_day date not null,
  tournament_week_start date not null,
  verification text not null default 'replay_verified' check(verification='replay_verified'),
  eligibility text not null default 'under_review' check(eligibility in ('under_review','valid','disqualified')),
  review_actor uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  check((eligibility='under_review') = (reviewed_at is null)),
  check(eligibility='under_review' or (review_actor is not null and length(review_note) between 1 and 500)),
  check(tournament_week_start = date_trunc('week',tournament_day::timestamp)::date)
);
create index flappy_runs_rank on private.flappy_runs(game_id,tournament_week_start,player_id,tournament_day,score desc) where eligibility='valid';
create table private.flappy_quotas (
  player_id uuid not null references auth.users(id) on delete restrict,
  action text not null check(action in ('start','checkpoint','finalize')),
  window_start timestamptz not null,
  count integer not null check(count>0),
  primary key(player_id,action)
);
alter table private.flappy_control enable row level security;
alter table private.flappy_sessions enable row level security;
alter table private.flappy_runs enable row level security;
alter table private.flappy_quotas enable row level security;
revoke all on private.flappy_control,private.flappy_sessions,private.flappy_runs,private.flappy_quotas from public,anon,authenticated,service_role;
-- Do not register or activate a game, nor alter any prize settings on migration.

create function public.flappy_consume_quota(p_player uuid,p_action text) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  if not exists(select 1 from private.flappy_control where enabled) then return false; end if;
  if p_action is null or p_action not in ('start','checkpoint','finalize') or p_player is null then return false; end if;
  insert into private.flappy_quotas(player_id,action,window_start,count)
  values(p_player,p_action,date_trunc('minute',clock_timestamp()),1)
  on conflict(player_id,action) do update set
    count=case when private.flappy_quotas.window_start=excluded.window_start then private.flappy_quotas.count+1 else 1 end,
    window_start=excluded.window_start returning count into v_count;
  return v_count <= case when p_action='start' then 6 else 30 end;
end $$;

create function public.flappy_start(p_player uuid,p_seed bigint,p_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.flappy_sessions%rowtype; v_game uuid; v_now timestamptz:=clock_timestamp();
begin
  if not exists(select 1 from private.flappy_control where enabled) then raise exception 'Disabled'; end if;
  perform pg_advisory_xact_lock(hashtextextended('flappy:player:'||p_player::text,0));
  if p_version is distinct from 'flappy-v1' or p_seed is null or p_seed<0 or p_seed>4294967295 then raise exception 'Invalid rules'; end if;
  if not exists(select 1 from auth.users where id=p_player and email_confirmed_at is not null)
    or not exists(select 1 from public.profiles where user_id=p_player and username is not null) then raise exception 'Player unavailable'; end if;
  select id into v_game from public.games where slug='flappy-race' and status='active';
  if v_game is null then raise exception 'Game unavailable'; end if;
  update private.flappy_sessions set status='expired' where player_id=p_player and status='active' and (expires_at<v_now or lease_until<v_now);
  if exists(select 1 from private.flappy_sessions where player_id=p_player and status='active') then raise exception 'Concurrent session'; end if;
  if (select count(*) from private.flappy_sessions where player_id=p_player and created_at>v_now-interval '1 hour')>=5 then raise exception 'Hourly limit'; end if;
  insert into private.flappy_sessions(player_id,game_id,version,seed,starts_at,expires_at,lease_until)
    values(p_player,v_game,p_version,p_seed,v_now+interval '3 seconds',v_now+interval '603 seconds',v_now+interval '18 seconds') returning * into s;
  return jsonb_build_object('sessionId',s.id,'seed',s.seed,'version',s.version,'startsAt',s.starts_at,'expiresAt',s.expires_at);
end $$;

create function public.flappy_read_session(p_player uuid,p_session uuid) returns jsonb
language sql security definer set search_path='' as $$
  select jsonb_build_object('version',s.version,'seed',s.seed,'status',s.status,
    'startsAt',s.starts_at,'expiresAt',s.expires_at,'leaseUntil',s.lease_until,
    'tick',s.tick,'inputs',s.inputs,'digest',s.digest,'outcome',s.outcome)
  from private.flappy_sessions s join public.games g on g.id=s.game_id and g.slug='flappy-race'
  where s.id=p_session and s.player_id=p_player
    and exists(select 1 from private.flappy_control where enabled);
$$;

create function public.flappy_record_evidence(p_player uuid,p_session uuid,p_action text,p_expected_tick integer,
  p_inputs integer[],p_tick integer,p_digest text,p_score integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.flappy_sessions%rowtype; v_now timestamptz:=clock_timestamp(); v_completed timestamptz; v_outcome jsonb; v_prev integer:=-4; v_input integer;
begin
  if not exists(select 1 from private.flappy_control where enabled) then raise exception 'Disabled'; end if;
  select s0.* into s from private.flappy_sessions s0 join public.games g on g.id=s0.game_id and g.slug='flappy-race'
    where s0.id=p_session and s0.player_id=p_player for update of s0;
  if not found then raise exception 'Session unavailable'; end if;
  if p_action is null or p_action not in ('checkpoint','finalize') or p_inputs is null or p_tick is null or p_digest is null or p_score is null
    or cardinality(p_inputs)>6000 or p_tick<1 or p_tick>36000 or p_score<0 or p_score>500 or p_digest !~ '^[a-f0-9]{64}$'
    or coalesce(array_ndims(p_inputs),1)<>1 or (cardinality(p_inputs)>0 and array_lower(p_inputs,1)<>1) then raise exception 'Invalid evidence'; end if;
  foreach v_input in array p_inputs loop
    if v_input is null or v_input<0 or v_input>=p_tick or v_input-v_prev<4 then raise exception 'Invalid input'; end if;
    v_prev:=v_input;
  end loop;
  if s.status='finalized' then
    if p_action='finalize' and p_tick=s.tick and p_digest=s.digest and p_inputs=s.inputs and p_score=(s.outcome->>'score')::integer then return s.outcome; end if;
    raise exception 'Finalization conflict';
  end if;
  if s.status<>'active' or v_now>s.expires_at or v_now>s.lease_until or v_now<s.starts_at then raise exception 'Expired'; end if;
  if p_expected_tick is distinct from s.tick or p_tick<s.tick or p_tick>floor(extract(epoch from (v_now-s.starts_at))*60)+2 then raise exception 'Evidence timing'; end if;
  if cardinality(p_inputs)<cardinality(s.inputs)
    or (cardinality(s.inputs)>0 and p_inputs[1:cardinality(s.inputs)]<>s.inputs)
    or exists(select 1 from unnest(p_inputs) with ordinality t(value,n) where n>cardinality(s.inputs) and value<s.tick) then raise exception 'Prefix conflict'; end if;
  if p_tick=s.tick then
    if p_action='checkpoint' and p_digest=s.digest and p_inputs=s.inputs then return jsonb_build_object('checkpointTick',s.tick); end if;
    raise exception 'No progress';
  end if;
  if p_action='checkpoint' then
    update private.flappy_sessions set inputs=p_inputs,tick=p_tick,digest=p_digest,lease_until=least(expires_at,v_now+interval '15 seconds') where id=s.id;
    return jsonb_build_object('checkpointTick',p_tick);
  end if;
  -- p_score/tick are trusted only from the server replay; no browser role has EXECUTE.
  -- Every replay stays under review because knowing a public seed enables bots.
  v_outcome:=jsonb_build_object('score',p_score,'collisionTick',p_tick,'eligibility','under_review','verification','replay_verified');
  v_completed:=s.starts_at+(p_tick::double precision/60)*interval '1 second';
  insert into private.flappy_runs(session_id,player_id,game_id,score,collision_tick,completed_at,tournament_day,tournament_week_start)
    values(s.id,s.player_id,s.game_id,p_score,p_tick,v_completed,(v_completed at time zone 'America/New_York')::date,
      date_trunc('week',v_completed at time zone 'America/New_York')::date);
  update private.flappy_sessions set status='finalized',inputs=p_inputs,tick=p_tick,digest=p_digest,outcome=v_outcome where id=s.id;
  return v_outcome;
end $$;

create function public.flappy_review_run(p_actor uuid,p_session uuid,p_decision text,p_note text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from private.admin_users where user_id=p_actor and is_active)
    or p_decision is null or p_decision not in ('valid','disqualified') or p_note is null or length(p_note) not between 1 and 500 then raise exception 'Review unavailable'; end if;
  update private.flappy_runs set eligibility=p_decision,review_actor=p_actor,reviewed_at=clock_timestamp(),review_note=p_note
    where session_id=p_session and eligibility='under_review';
  if not found then raise exception 'Run unavailable'; end if;
end $$;

-- Restricted read: public player names only, no contact/payout fields or IDs.
create function public.flappy_read_ranking(p_week date,p_page integer) returns jsonb
language sql stable security definer set search_path='' as $$
with ranked_daily as (
  select r.*,row_number() over(partition by r.player_id,r.tournament_day order by r.score desc,r.session_id) daily_rank
  from private.flappy_runs r join public.games g on g.id=r.game_id and g.slug='flappy-race'
  where r.tournament_week_start=p_week and r.eligibility='valid'
), totals as (
  select player_id,sum(score) filter(where daily_rank<=7) weekly_total from ranked_daily group by player_id
), vectors as (
  select player_id,array_agg(score order by score desc) individual_scores from ranked_daily group by player_id
), ranked as (
  select t.player_id,t.weekly_total,rank() over(order by t.weekly_total desc,v.individual_scores desc) position,
    count(*) over(partition by t.weekly_total,v.individual_scores)>1 review
  from totals t join vectors v using(player_id)
), public_rows as (
  select r.*,p.username from ranked r join public.profiles p on p.user_id=r.player_id where p.username is not null
), page as (
  select * from public_rows order by position,username limit 50 offset (p_page-1)*50
)
select case when p_page between 1 and 100 and extract(isodow from p_week)=1 then
  jsonb_build_object('entries',coalesce((select jsonb_agg(jsonb_build_object(
    'rank',case when review then null else position end,'username',username,
    'weeklyTotal',weekly_total,'reviewRequired',review) order by position,username) from page),'[]'::jsonb),
    'hasNextPage',(select count(*) from public_rows)>p_page*50 and p_page<100)
  else null end;
$$;

revoke all on function public.flappy_consume_quota(uuid,text),public.flappy_start(uuid,bigint,text),
  public.flappy_read_session(uuid,uuid),public.flappy_record_evidence(uuid,uuid,text,integer,integer[],integer,text,integer),
  public.flappy_review_run(uuid,uuid,text,text),public.flappy_read_ranking(date,integer) from public,anon,authenticated;
grant execute on function public.flappy_consume_quota(uuid,text),public.flappy_start(uuid,bigint,text),
  public.flappy_read_session(uuid,uuid),public.flappy_record_evidence(uuid,uuid,text,integer,integer[],integer,text,integer),
  public.flappy_review_run(uuid,uuid,text,text),public.flappy_read_ranking(date,integer) to service_role;
-- Rollback: close both gates and retain all evidence. Removing this migration's
-- functions/tables is a separate, explicitly destructive operation; never auto-drop.
