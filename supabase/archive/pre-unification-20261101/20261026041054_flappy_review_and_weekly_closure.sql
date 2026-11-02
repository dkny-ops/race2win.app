-- Flappy-only extension. Keep all activation gates CLOSED.
-- No RTW scoring, Auth, prize, balance or payment objects are changed.
create index flappy_runs_review_queue on private.flappy_runs(tournament_week_start,eligibility,completed_at);
create table private.flappy_review_events (
 session_id uuid primary key references private.flappy_runs(session_id) on delete restrict,
 actor uuid not null references auth.users(id) on delete restrict,
 decision text not null check(decision in ('valid','disqualified')),
 note text not null check(length(note) between 1 and 500),
 evidence_digest text not null,
 created_at timestamptz not null default clock_timestamp()
);
create table private.flappy_week_closures (
 week date primary key check(extract(isodow from week)=1),
 actor uuid not null references auth.users(id) on delete restrict,
 closed_at timestamptz not null default clock_timestamp()
);
create table private.flappy_week_results (
 week date not null references private.flappy_week_closures(week) on delete restrict,
 player_id uuid not null references auth.users(id) on delete restrict,
 username text not null,
 weekly_total bigint not null check(weekly_total>=0),
 scores integer[] not null,
 rank_position bigint,
 review_required boolean not null,
 primary key(week,player_id),
 check((rank_position is null)=review_required)
);
alter table private.flappy_review_events enable row level security;
alter table private.flappy_week_closures enable row level security;
alter table private.flappy_week_results enable row level security;
revoke all on private.flappy_review_events,private.flappy_week_closures,private.flappy_week_results from public,anon,authenticated,service_role;

create function private.flappy_standings(p_week date)
returns table(player_id uuid,weekly_total bigint,scores integer[],rank_position bigint,review_required boolean)
language sql stable security definer set search_path='' as $$
 with daily as (
  select r.*,row_number() over(partition by r.player_id,r.tournament_day order by r.score desc,r.session_id) daily_rank
  from private.flappy_runs r join public.games g on g.id=r.game_id and g.slug='flappy-race'
  where r.tournament_week_start=p_week and r.eligibility='valid'
 ), vectors as (
  select d.player_id,sum(d.score) filter(where d.daily_rank<=7)::bigint total,
   array_agg(d.score order by d.score desc) score_vector from daily d group by d.player_id
 ), ranked as (
  select v.*,rank() over(order by v.total desc,v.score_vector desc) position,
   count(*) over(partition by v.total,v.score_vector)>1 tied from vectors v
 )
 select r.player_id,r.total,r.score_vector,case when r.tied then null else r.position end,r.tied from ranked r;
$$;
revoke all on function private.flappy_standings(date) from public,anon,authenticated,service_role;

create or replace function public.flappy_review_run(p_actor uuid,p_session uuid,p_decision text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare r private.flappy_runs%rowtype; s private.flappy_sessions%rowtype; v_week date;
begin
 if not exists(select 1 from private.admin_users where user_id=p_actor and is_active)
  or p_decision is null or p_decision not in ('valid','disqualified') or p_note is null
  or length(btrim(p_note)) not between 1 and 500 then raise exception 'Review unavailable'; end if;
 select tournament_week_start into v_week from private.flappy_runs where session_id=p_session;
 if v_week is null then raise exception 'Run unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended('flappy:week:'||v_week::text,0));
 select * into r from private.flappy_runs where session_id=p_session for update;
 if r.eligibility<>'under_review' then
  if r.eligibility=p_decision and r.review_actor=p_actor and r.review_note=btrim(p_note)
   and exists(select 1 from private.flappy_review_events e where e.session_id=p_session and e.actor=p_actor and e.decision=p_decision and e.note=btrim(p_note)) then return; end if;
  raise exception 'Review conflict';
 end if;
 if exists(select 1 from private.flappy_week_closures where week=v_week) then raise exception 'Week closed'; end if;
 select * into s from private.flappy_sessions where id=p_session;
 if s.status<>'finalized' or s.digest is null or s.version<>'flappy-v1'
  or s.tick<>r.collision_tick or s.outcome->>'verification' is distinct from 'replay_verified'
  or (s.outcome->>'score')::integer is distinct from r.score then raise exception 'Evidence unavailable'; end if;
 insert into private.flappy_review_events(session_id,actor,decision,note,evidence_digest)
 values(p_session,p_actor,p_decision,btrim(p_note),s.digest);
 update private.flappy_runs set eligibility=p_decision,review_actor=p_actor,reviewed_at=clock_timestamp(),review_note=btrim(p_note) where session_id=p_session;
end $$;

create or replace function public.flappy_read_ranking(p_week date,p_page integer)
returns jsonb language sql stable security definer set search_path='' as $$
 with standings as (
  select s.player_id,s.weekly_total,s.scores,s.rank_position,s.review_required,p.username
  from private.flappy_standings(p_week) s join public.profiles p on p.user_id=s.player_id
  where p.username is not null and not exists(select 1 from private.flappy_week_closures where week=p_week)
  union all
  select r.player_id,r.weekly_total,r.scores,r.rank_position,r.review_required,r.username from private.flappy_week_results r where r.week=p_week
 ), page as (
  select * from standings order by weekly_total desc,scores desc,username,player_id limit 50 offset (p_page-1)*50
 )
 select case when p_page between 1 and 100 and extract(isodow from p_week)=1 then
 jsonb_build_object('entries',coalesce((select jsonb_agg(jsonb_build_object('rank',rank_position,'username',username,'weeklyTotal',weekly_total,'reviewRequired',review_required) order by weekly_total desc,scores desc,username,player_id) from page),'[]'::jsonb),
 'hasNextPage',(select count(*) from standings)>p_page*50 and p_page<100) else null end;
$$;

create function public.flappy_close_week(p_actor uuid,p_week date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.flappy_week_closures%rowtype;
begin
 if not exists(select 1 from private.admin_users where user_id=p_actor and is_active)
  or p_week is null or extract(isodow from p_week)<>1 then raise exception 'Close unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended('flappy:week:'||p_week::text,0));
 select * into c from private.flappy_week_closures where week=p_week;
 if found then return jsonb_build_object('week',c.week,'closedAt',c.closed_at); end if;
 -- 11-minute settlement margin exceeds the maximum 10-minute run + countdown.
 -- Prevent late, back-dated FINALIZE from entering a frozen previous week.
 if clock_timestamp()<((p_week+7)::timestamp at time zone 'America/New_York')+interval '11 minutes'
  or exists(select 1 from private.flappy_runs where tournament_week_start=p_week and eligibility='under_review')
 then raise exception 'Week not ready'; end if;
 insert into private.flappy_week_closures(week,actor) values(p_week,p_actor) returning * into c;
 insert into private.flappy_week_results(week,player_id,username,weekly_total,scores,rank_position,review_required)
 select p_week,s.player_id,p.username,s.weekly_total,s.scores,s.rank_position,s.review_required
 from private.flappy_standings(p_week) s join public.profiles p on p.user_id=s.player_id where p.username is not null;
 return jsonb_build_object('week',c.week,'closedAt',c.closed_at);
end $$;

create function public.flappy_read_week(p_week date) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when p_week is null or extract(isodow from p_week)<>1 then null else
 jsonb_build_object('week',p_week,'closedAt',(select closed_at from private.flappy_week_closures where week=p_week),
 'pendingRuns',(select count(*) from private.flappy_runs where tournament_week_start=p_week and eligibility='under_review'),
 'state',case when exists(select 1 from private.flappy_week_closures where week=p_week) then 'closed'
  when clock_timestamp()<((p_week+7)::timestamp at time zone 'America/New_York')+interval '11 minutes' then 'open'
  when exists(select 1 from private.flappy_runs where tournament_week_start=p_week and eligibility='under_review') then 'awaiting_review' else 'ready_to_close' end,
 'winners',coalesce((select jsonb_agg(jsonb_build_object('rank',r.rank_position,'username',r.username,'weeklyTotal',r.weekly_total) order by r.rank_position)
 from private.flappy_week_results r where r.week=p_week and r.rank_position between 1 and 3 and not r.review_required),'[]'::jsonb),
 'exactTiesPending',exists(select 1 from private.flappy_week_results where week=p_week and review_required),
 'prizesEnabled',false,'paymentsEnabled',false) end;
$$;

revoke all on function public.flappy_review_run(uuid,uuid,text,text),public.flappy_read_ranking(date,integer),
 public.flappy_close_week(uuid,date),public.flappy_read_week(date) from public,anon,authenticated;
grant execute on function public.flappy_review_run(uuid,uuid,text,text),public.flappy_read_ranking(date,integer),
 public.flappy_close_week(uuid,date),public.flappy_read_week(date) to service_role;
-- Register the independent catalogue entry, paused. No flag or prize activation.
insert into public.games(slug,display_name,status) values('flappy-race','FlappyRace','paused') on conflict(slug) do nothing;
