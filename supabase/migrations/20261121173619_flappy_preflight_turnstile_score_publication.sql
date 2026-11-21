-- Flappy Race only. Forward-only replacement for the temporary review-only
-- trigger. Historical runs are intentionally untouched.
set lock_timeout = '5s';
set statement_timeout = '30s';

create table if not exists private.flappy_preflight_checks(
  nonce uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  consumed_at timestamptz,
  session_id uuid unique references private.flappy_sessions(id) on delete restrict,
  check(expires_at > created_at),
  check((consumed_at is null and session_id is null) or (consumed_at is not null and session_id is not null))
);
create index if not exists flappy_preflight_player_created_idx on private.flappy_preflight_checks(player_id,created_at desc);
alter table private.flappy_preflight_checks enable row level security;
revoke all on private.flappy_preflight_checks from public, anon, authenticated, service_role;

create or replace function public.flappy_create_preflight(p_player uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_nonce uuid; v_now timestamptz:=clock_timestamp(); v_expires timestamptz:=v_now+interval '5 minutes';
begin
  if p_player is null or not exists(select 1 from private.flappy_control where enabled)
    or not exists(select 1 from auth.users where id=p_player and email_confirmed_at is not null)
    or not exists(select 1 from public.profiles where user_id=p_player and username is not null) then
    raise exception 'Preflight unavailable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('flappy:preflight:'||p_player::text,0));
  delete from private.flappy_preflight_checks where player_id=p_player and consumed_at is null;
  insert into private.flappy_preflight_checks(player_id,expires_at) values(p_player,v_expires) returning nonce into v_nonce;
  return jsonb_build_object('nonce',v_nonce,'expiresAt',v_expires);
end $$;

-- The service-only route verifies Siteverify before calling this function.
-- It atomically attaches that one-time evidence to the newly-created session.
create or replace function public.flappy_start(p_player uuid,p_seed bigint,p_version text,p_preflight uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.flappy_sessions%rowtype; v_game uuid; v_now timestamptz:=clock_timestamp(); p private.flappy_preflight_checks%rowtype;
begin
  if not exists(select 1 from private.flappy_control where enabled) then raise exception 'Disabled'; end if;
  if p_version is distinct from 'flappy-v1' or p_seed is null or p_seed<0 or p_seed>4294967295 or p_preflight is null then raise exception 'Invalid rules'; end if;
  perform pg_advisory_xact_lock(hashtextextended('flappy:player:'||p_player::text,0));
  select * into p from private.flappy_preflight_checks where nonce=p_preflight and player_id=p_player for update;
  if not found or p.consumed_at is not null or p.expires_at<v_now then raise exception 'Preflight required'; end if;
  if not exists(select 1 from auth.users where id=p_player and email_confirmed_at is not null) or not exists(select 1 from public.profiles where user_id=p_player and username is not null) then raise exception 'Player unavailable'; end if;
  select id into v_game from public.games where slug='flappy-race' and status='active';
  if v_game is null then raise exception 'Game unavailable'; end if;
  update private.flappy_sessions set status='expired' where player_id=p_player and status='active' and (expires_at<v_now or lease_until<v_now);
  if exists(select 1 from private.flappy_sessions where player_id=p_player and status='active') then raise exception 'Concurrent session'; end if;
  if not exists(select 1 from public.rtw_hourly_limit_test_exemptions where player_id=p_player)
    and (select count(*) from private.flappy_sessions where player_id=p_player and created_at>v_now-interval '1 hour')>=5 then raise exception 'Hourly limit'; end if;
  insert into private.flappy_sessions(player_id,game_id,version,seed,starts_at,expires_at,lease_until)
  values(p_player,v_game,p_version,p_seed,v_now+interval '3 seconds',v_now+interval '603 seconds',v_now+interval '18 seconds') returning * into s;
  update private.flappy_preflight_checks set verified_at=v_now,consumed_at=v_now,session_id=s.id where nonce=p.nonce;
  return jsonb_build_object('sessionId',s.id,'seed',s.seed,'version',s.version,'startsAt',s.starts_at,'expiresAt',s.expires_at);
end $$;

-- The obsolete mid-flight trigger remains installed for migration compatibility,
-- but it deliberately creates no work during a race.
create or replace function private.flappy_turnstile_start()
returns trigger language plpgsql security definer set search_path='' as $$
begin return new; end $$;

create or replace function private.flappy_turnstile_require()
returns trigger language plpgsql security definer set search_path='' as $$
declare p private.flappy_preflight_checks%rowtype; v_gaps integer[]; v_perfect boolean:=false;
begin
  select * into p from private.flappy_preflight_checks
   where session_id=new.session_id and player_id=new.player_id and verified_at is not null and consumed_at is not null
   for key share;
  -- Keep the currently deployed, review-only client compatible during the
  -- code/migration rollout. It can never publish: it has no bound preflight.
  if not found then
    new.verification := 'replay_verified';
    new.eligibility := 'under_review';
    new.review_note := coalesce(new.review_note,'preflight_missing');
    return new;
  end if;
  -- A server replay proves the score. This conservative telemetry signal holds,
  -- rather than publishes, unusually machine-perfect high-score input streams.
  select array_agg(value-lag_value) into v_gaps from (
    select value,lag(value) over(order by ordinality) lag_value
    from unnest((select inputs from private.flappy_sessions where id=new.session_id)) with ordinality
  ) gaps where lag_value is not null;
  if new.score >= 15 and cardinality(v_gaps) >= 12
    and (select count(distinct gap) from unnest(v_gaps) gap)=1 then v_perfect:=true; end if;
  new.verification := 'replay_verified';
  new.eligibility := case when v_perfect then 'under_review' else 'valid' end;
  if v_perfect then new.review_note := coalesce(new.review_note,'automated_input_pattern'); end if;
  return new;
end $$;

create or replace function public.flappy_record_evidence(p_player uuid, p_session uuid, p_action text, p_expected_tick integer, p_inputs integer[], p_tick integer, p_digest text, p_score integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.flappy_sessions%rowtype; r private.flappy_runs%rowtype; v_now timestamptz:=clock_timestamp(); v_completed timestamptz; v_outcome jsonb; v_prev integer:=-4; v_input integer;
begin
  if not exists(select 1 from private.flappy_control where enabled) then raise exception 'Disabled'; end if;
  select s0.* into s from private.flappy_sessions s0 join public.games g on g.id=s0.game_id and g.slug='flappy-race' where s0.id=p_session and s0.player_id=p_player for update of s0;
  if not found then raise exception 'Session unavailable'; end if;
  if p_action is null or p_action not in ('checkpoint','finalize') or p_inputs is null or p_tick is null or p_digest is null or p_score is null or cardinality(p_inputs)>6000 or p_tick<1 or p_tick>36000 or p_score<0 or p_score>500 or p_digest !~ '^[a-f0-9]{64}$' or coalesce(array_ndims(p_inputs),1)<>1 or (cardinality(p_inputs)>0 and array_lower(p_inputs,1)<>1) then raise exception 'Invalid evidence'; end if;
  foreach v_input in array p_inputs loop if v_input is null or v_input<0 or v_input>=p_tick or v_input-v_prev<4 then raise exception 'Invalid input'; end if; v_prev:=v_input; end loop;
  if s.status='finalized' then if p_action='finalize' and p_tick=s.tick and p_digest=s.digest and p_inputs=s.inputs and p_score=(s.outcome->>'score')::integer then return s.outcome; end if; raise exception 'Finalization conflict'; end if;
  if s.status<>'active' or v_now>s.expires_at or v_now>s.lease_until or v_now<s.starts_at then raise exception 'Expired'; end if;
  if p_expected_tick is distinct from s.tick or p_tick<s.tick or p_tick>floor(extract(epoch from (v_now-s.starts_at))*60)+2 then raise exception 'Evidence timing'; end if;
  if cardinality(p_inputs)<cardinality(s.inputs) or (cardinality(s.inputs)>0 and p_inputs[1:cardinality(s.inputs)]<>s.inputs) or exists(select 1 from unnest(p_inputs) with ordinality t(value,n) where n>cardinality(s.inputs) and value<s.tick) then raise exception 'Prefix conflict'; end if;
  if p_tick=s.tick then if p_action='checkpoint' and p_digest=s.digest and p_inputs=s.inputs then return jsonb_build_object('checkpointTick',s.tick); end if; raise exception 'No progress'; end if;
  if p_action='checkpoint' then update private.flappy_sessions set inputs=p_inputs,tick=p_tick,digest=p_digest,lease_until=least(expires_at,v_now+interval '15 seconds') where id=s.id; return jsonb_build_object('checkpointTick',p_tick); end if;
  v_completed:=s.starts_at+(p_tick::double precision/60)*interval '1 second';
  -- Make the complete server-replayed evidence visible to the BEFORE INSERT
  -- telemetry policy. A trigger failure rolls this update back atomically.
  update private.flappy_sessions set inputs=p_inputs,tick=p_tick,digest=p_digest where id=s.id;
  insert into private.flappy_runs(session_id,player_id,game_id,score,collision_tick,completed_at,tournament_day,tournament_week_start,eligibility)
  values(s.id,s.player_id,s.game_id,p_score,p_tick,v_completed,(v_completed at time zone 'America/New_York')::date,date_trunc('week',v_completed at time zone 'America/New_York')::date,'under_review') returning * into r;
  v_outcome:=jsonb_build_object('score',r.score,'collisionTick',r.collision_tick,'eligibility',r.eligibility,'verification',r.verification);
  update private.flappy_sessions set status='finalized',inputs=p_inputs,tick=p_tick,digest=p_digest,outcome=v_outcome where id=s.id;
  return v_outcome;
end $$;

revoke all on function private.flappy_turnstile_start(),private.flappy_turnstile_require(),public.flappy_create_preflight(uuid),public.flappy_start(uuid,bigint,text,uuid),public.flappy_record_evidence(uuid,uuid,text,integer,integer[],integer,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.flappy_create_preflight(uuid),public.flappy_start(uuid,bigint,text,uuid),public.flappy_record_evidence(uuid,uuid,text,integer,integer[],integer,text,integer) to service_role;
